// Embeds the Roicon logo as the .exe icon (assets/roicon.ico, made with --export-logo).
fn main() {
    println!("cargo:rerun-if-changed=assets/roicon.ico");
    if std::path::Path::new("assets/roicon.ico").exists() && std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        let mut res = winresource::WindowsResource::new();
        res.set_icon("assets/roicon.ico");
        res.set("ProductName", "Roicon");
        res.set("FileDescription", "Roicon: countdown icons for Roblox");
        let _ = res.compile();
    }
}
