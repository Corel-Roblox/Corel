// Build steps:
// 1. Embed the Roicon logo as the .exe icon (assets/roicon.ico, made with --export-logo).
// 2. Embed the OAuth client secret so users don't have to paste it. It comes from the
//    ROICON_CLIENT_SECRET env var, or from Windows Credential Manager where Roicon saved it
//    ("Roicon" / "roblox-oauth-client-secret"). It is never written to the source tree.
//    It is XOR-masked in the binary, which hides it from casual inspection, not from a
//    determined person; if it leaks, regenerate it in Creator Hub and rebuild.
use rand::Rng;

fn main() {
    println!("cargo:rerun-if-changed=assets/roicon.ico");
    println!("cargo:rerun-if-env-changed=ROICON_CLIENT_SECRET");
    println!("cargo:rerun-if-env-changed=ROICON_NO_EMBED");

    if std::path::Path::new("assets/roicon.ico").exists() && std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        let mut res = winresource::WindowsResource::new();
        res.set_icon("assets/roicon.ico");
        res.set("ProductName", "Roicon");
        res.set("FileDescription", "Roicon: countdown icons for Roblox");
        let _ = res.compile();
    }

    if std::env::var_os("ROICON_NO_EMBED").is_some() {
        return;
    }
    let secret = std::env::var("ROICON_CLIENT_SECRET").ok().filter(|s| !s.trim().is_empty()).or_else(|| {
        keyring::Entry::new("Roicon", "roblox-oauth-client-secret").ok().and_then(|e| e.get_password().ok())
    });
    if let Some(secret) = secret {
        let mut rng = rand::rng();
        let key: Vec<u8> = (0..secret.len()).map(|_| rng.random()).collect();
        let masked: String = secret.bytes().zip(&key).map(|(b, k)| format!("{:02x}", b ^ k)).collect();
        let key_hex: String = key.iter().map(|k| format!("{k:02x}")).collect();
        println!("cargo:rustc-env=ROICON_SECRET_X={masked}");
        println!("cargo:rustc-env=ROICON_SECRET_K={key_hex}");
        println!("cargo:warning=Roicon: OAuth client secret embedded in this build.");
    }
}
