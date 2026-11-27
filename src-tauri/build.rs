// Build steps:
// 1. tauri-build embeds the Corel icon (icons/icon.ico) and version info from tauri.conf.json.
// 2. Embed the Roblox OAuth client secret so users never see or edit it. It comes only from the
//    COREL_CLIENT_SECRET env var at build time (ROICON_CLIENT_SECRET is still accepted so
//    existing CI secrets keep working) and is never written to the source tree.
//    It is XOR-masked in the binary, which hides it from casual inspection, not from a
//    determined person; if it leaks, regenerate it in Creator Hub and rebuild.
use rand::Rng;

fn main() {
    println!("cargo:rerun-if-env-changed=COREL_CLIENT_SECRET");
    println!("cargo:rerun-if-env-changed=ROICON_CLIENT_SECRET");
    println!("cargo:rerun-if-env-changed=COREL_NO_EMBED");

    tauri_build::build();

    if std::env::var_os("COREL_NO_EMBED").is_some() {
        return;
    }
    let secret = std::env::var("COREL_CLIENT_SECRET")
        .or_else(|_| std::env::var("ROICON_CLIENT_SECRET"))
        .ok()
        .map(|s| s.trim().to_owned())
        .filter(|s| !s.is_empty());
    let Some(secret) = secret else {
        println!("cargo:warning=Corel: COREL_CLIENT_SECRET not set; Sign in with Roblox is disabled in this build (API keys still work).");
        return;
    };
    let mut rng = rand::rng();
    let key: Vec<u8> = (0..secret.len()).map(|_| rng.random()).collect();
    let masked: String = secret.bytes().zip(&key).map(|(b, k)| format!("{:02x}", b ^ k)).collect();
    let key_hex: String = key.iter().map(|k| format!("{k:02x}")).collect();
    println!("cargo:rustc-env=COREL_SECRET_X={masked}");
    println!("cargo:rustc-env=COREL_SECRET_K={key_hex}");
}
