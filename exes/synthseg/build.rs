// Verify the embedded model against packages/synthseg/model.manifest.json before compiling.
use std::{env, fs, path::Path};

fn main() {
    let dir = env::var("CARGO_MANIFEST_DIR").unwrap();
    let manifest = Path::new(&dir).join("../../packages/synthseg/model.manifest.json");
    let manifest: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(&manifest).unwrap()).unwrap();
    let asset = &manifest["assets"][0];
    let path = Path::new(&dir)
        .join("models")
        .join(asset["filename"].as_str().unwrap());
    println!("cargo:rerun-if-changed={}", path.display());
    println!("cargo:rerun-if-changed=../../packages/synthseg/model.manifest.json");
    let bytes = fs::read(&path)
        .unwrap_or_else(|_| panic!("missing {}; run `make check-model`", path.display()));
    let hash = format!("{:x}", <sha2::Sha256 as sha2::Digest>::digest(&bytes));
    assert_eq!(
        bytes.len() as u64,
        asset["bytes"].as_u64().unwrap(),
        "model size mismatch"
    );
    assert_eq!(
        hash,
        asset["sha256"].as_str().unwrap(),
        "model sha256 mismatch"
    );
    println!("cargo:rustc-env=SYNTHSEG_MODEL_PATH={}", path.display());
    println!("cargo:rustc-env=SYNTHSEG_MODEL_SHA256={hash}");
}
