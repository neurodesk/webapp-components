#![allow(clippy::needless_range_loop)]
// SynthSeg posterior handling: GaussianBlur(sigma=0.5), left/right flip averaging and postprocess().
// Posteriors are channel-major: `post[c * voxels + mi(x, y, z, dims)]`, 33 channels.
use crate::volume::{mi, Prepared};

pub const N: usize = 33;
pub const LABELS: [i32; N] = [
    0, 2, 3, 4, 5, 7, 8, 10, 11, 12, 13, 14, 15, 16, 17, 18, 24, 26, 28, 41, 42, 43, 44, 46, 47,
    49, 50, 51, 52, 53, 54, 58, 60,
];
// get_flip_indices(labels, n_neutral_labels=19): channel of the contralateral structure.
const FLIP: [usize; N] = [
    0, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 11, 12, 13, 29, 30, 16, 31, 32, 1, 2, 3, 4, 5, 6, 7,
    8, 9, 10, 14, 15, 17, 18,
];
// synthseg_topological_classes_2.0.npy[unique_idx]; class 0 is exempt.
const TOPOLOGY: [u8; N] = [
    0, 4, 4, 4, 4, 5, 5, 6, 7, 8, 9, 1, 2, 3, 10, 11, 0, 12, 13, 14, 14, 14, 14, 15, 15, 16, 17,
    18, 19, 20, 21, 22, 23,
];

/// GaussianBlur(sigma=0.5): 3x3x3 kernel with zero padding, per channel, in place. The kernel is an
/// outer product of the 1-D kernel, so three separable passes; channels run on all cores.
pub fn blur(post: &mut [f32], d: &[usize; 3], threads: usize) {
    let side = (-1.0f64 / (2.0 * 0.25)).exp();
    let k = [
        (side / (1.0 + 2.0 * side)) as f32,
        (1.0 / (1.0 + 2.0 * side)) as f32,
    ];
    let voxels = d[0] * d[1] * d[2];
    let strides = [d[1] * d[2], d[2], 1];
    let per = N.div_ceil(threads.max(1));
    std::thread::scope(|s| {
        for chunk in post.chunks_mut(per * voxels) {
            s.spawn(move || {
                let mut tmp = vec![0f32; voxels];
                for dst in chunk.chunks_mut(voxels) {
                    for axis in 0..3 {
                        let (n, stride) = (d[axis], strides[axis]);
                        for (i, t) in tmp.iter_mut().enumerate() {
                            let pos = i / stride % n;
                            let mut v = dst[i] * k[1];
                            if pos > 0 {
                                v += dst[i - stride] * k[0];
                            }
                            if pos + 1 < n {
                                v += dst[i + stride] * k[0];
                            }
                            *t = v;
                        }
                        dst.copy_from_slice(&tmp);
                    }
                }
            });
        }
    });
}

/// post = 0.5 * (post + flipped_back_and_reordered(other)); `other` came from the x-flipped input.
pub fn average_flipped(post: &mut [f32], other: &[f32], d: &[usize; 3]) {
    let voxels = d[0] * d[1] * d[2];
    let slab = d[1] * d[2];
    for c in 0..N {
        let src = &other[FLIP[c] * voxels..(FLIP[c] + 1) * voxels];
        let dst = &mut post[c * voxels..(c + 1) * voxels];
        for x in 0..d[0] {
            let (a, b) = (x * slab, (d[0] - 1 - x) * slab);
            for i in 0..slab {
                dst[a + i] = 0.5 * (dst[a + i] + src[b + i]);
            }
        }
    }
}

// scipy.ndimage.label with the default (6-connected) structure, keeping the largest component.
fn largest_component(mask: &mut [bool], d: &[usize; 3]) {
    let n = mask.len();
    let mut comp = vec![0u32; n];
    let (mut best, mut best_id, mut id) = (0usize, 0u32, 0u32);
    let mut stack = Vec::new();
    for s in 0..n {
        if !mask[s] || comp[s] != 0 {
            continue;
        }
        id += 1;
        comp[s] = id;
        stack.push(s);
        let mut size = 0;
        while let Some(i) = stack.pop() {
            size += 1;
            let (z, rest) = (i % d[2], i / d[2]);
            let (y, x) = (rest % d[1], rest / d[1]);
            let mut visit = |j: usize| {
                if mask[j] && comp[j] == 0 {
                    comp[j] = id;
                    stack.push(j);
                }
            };
            if x > 0 {
                visit(i - d[1] * d[2]);
            }
            if x + 1 < d[0] {
                visit(i + d[1] * d[2]);
            }
            if y > 0 {
                visit(i - d[2]);
            }
            if y + 1 < d[1] {
                visit(i + d[2]);
            }
            if z > 0 {
                visit(i - 1);
            }
            if z + 1 < d[2] {
                visit(i + 1);
            }
        }
        if size > best {
            best = size;
            best_id = id;
        }
    }
    for i in 0..n {
        mask[i] = comp[i] == best_id && best_id != 0;
    }
}

fn crop(post: &[f32], p: &Prepared) -> Vec<f32> {
    let (pd, al, o) = (&p.padded, &p.aligned, &p.offsets);
    let (pv, av) = (pd[0] * pd[1] * pd[2], al[0] * al[1] * al[2]);
    let mut out = vec![0f32; N * av];
    for c in 0..N {
        for x in 0..al[0] {
            for y in 0..al[1] {
                let src = c * pv + mi(x + o[0], y + o[1], o[2], pd);
                let dst = c * av + mi(x, y, 0, al);
                out[dst..dst + al[2]].copy_from_slice(&post[src..src + al[2]]);
            }
        }
    }
    out
}

fn mask_foreground(post: &mut [f32], d: &[usize; 3]) {
    let voxels = d[0] * d[1] * d[2];
    let mut mask: Vec<bool> = (0..voxels)
        .map(|v| (1..N).map(|c| post[c * voxels + v]).sum::<f32>() > 0.25)
        .collect();
    largest_component(&mut mask, d);
    for c in 1..N {
        for v in 0..voxels {
            if !mask[v] {
                post[c * voxels + v] = 0.0;
            }
        }
    }
}

/// SynthSeg postprocess() on padded posteriors -> labels in aligned space (`mi` order).
pub fn labels(post: Vec<f32>, p: &Prepared, fast: bool) -> Vec<i32> {
    let mut post = post;
    let mut d = p.padded;
    if fast {
        post = crop(&post, p);
        d = p.aligned;
    }
    mask_foreground(&mut post, &d);
    let voxels = d[0] * d[1] * d[2];
    if fast {
        for v in voxels..N * voxels {
            if post[v] <= 0.2 {
                post[v] = 0.0;
            }
        }
    } else {
        let mut mask = vec![false; voxels];
        for class in 1..=*TOPOLOGY.iter().max().unwrap() {
            let channels: Vec<usize> = (0..N).filter(|&c| TOPOLOGY[c] == class).collect();
            for v in 0..voxels {
                mask[v] = channels.iter().any(|&c| post[c * voxels + v] > 0.25);
            }
            largest_component(&mut mask, &d);
            for &c in &channels {
                for v in 0..voxels {
                    if !mask[v] {
                        post[c * voxels + v] = 0.0;
                    }
                }
            }
        }
        post = crop(&post, p);
        d = p.aligned;
    }
    let voxels = d[0] * d[1] * d[2];
    // Dividing by the channel sum does not move the argmax; an all-zero voxel is NaN in NumPy and argmax gives 0.
    (0..voxels)
        .map(|v| {
            let mut best = 0;
            for c in 1..N {
                if post[c * voxels + v] > post[best * voxels + v] {
                    best = c;
                }
            }
            LABELS[best]
        })
        .collect()
}
