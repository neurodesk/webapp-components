// Verify the embedded model against packages/synthsr/model.manifest.json before compiling.
use std::{env, fs, path::Path};

fn main() {
    let dir = env::var("CARGO_MANIFEST_DIR").unwrap();
    let manifest =
        fs::read_to_string(Path::new(&dir).join("../../packages/synthsr/model.manifest.json"))
            .unwrap();
    let manifest: serde_json::Value = serde_json::from_str(&manifest).unwrap();
    let asset = &manifest["assets"][0];
    let path = Path::new(&dir)
        .join("models")
        .join(asset["filename"].as_str().unwrap());
    println!("cargo:rerun-if-changed={}", path.display());
    println!("cargo:rerun-if-changed=../../packages/synthsr/model.manifest.json");
    let bytes = fs::read(&path)
        .unwrap_or_else(|_| panic!("missing {}; run `make check-model`", path.display()));
    let hash = sha256_hex(&bytes);
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
    println!("cargo:rustc-env=SYNTHSR_MODEL_PATH={}", path.display());
    println!("cargo:rustc-env=SYNTHSR_MODEL_SHA256={hash}");
}

fn sha256_hex(bytes: &[u8]) -> String {
    use sha2::Digest;
    format!("{:x}", sha2::Sha256::digest(bytes))
}
