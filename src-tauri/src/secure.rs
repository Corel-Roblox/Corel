//! Encrypted storage for the workspace sign-in session (Supabase tokens).
//!
//! Values are encrypted with Windows DPAPI (CryptProtectData), which ties them to the
//! signed-in Windows user, and written to %APPDATA%\Corel\secure\<sha256(key)>.bin.
//! Credential Manager is not used here because sessions exceed its 2.5 KB limit.

use sha2::{Digest, Sha256};
use std::path::PathBuf;
use windows_sys::Win32::Foundation::LocalFree;
use windows_sys::Win32::Security::Cryptography::{CryptProtectData, CryptUnprotectData, CRYPT_INTEGER_BLOB};

const ENTROPY: &[u8] = b"corel.session.v1";

fn dir() -> PathBuf {
    crate::store::data_dir().join("secure")
}

fn path(key: &str) -> PathBuf {
    let h = Sha256::digest(key.as_bytes());
    let name: String = h.iter().take(16).map(|b| format!("{b:02x}")).collect();
    dir().join(format!("{name}.bin"))
}

fn blob(data: &[u8]) -> CRYPT_INTEGER_BLOB {
    CRYPT_INTEGER_BLOB { cbData: data.len() as u32, pbData: data.as_ptr() as *mut u8 }
}

fn protect(plain: &[u8]) -> Result<Vec<u8>, String> {
    let input = blob(plain);
    let entropy = blob(ENTROPY);
    let mut out = CRYPT_INTEGER_BLOB { cbData: 0, pbData: std::ptr::null_mut() };
    let ok = unsafe { CryptProtectData(&input, std::ptr::null(), &entropy, std::ptr::null(), std::ptr::null(), 0, &mut out) };
    if ok == 0 {
        return Err("Windows could not encrypt the session.".into());
    }
    let v = unsafe { std::slice::from_raw_parts(out.pbData, out.cbData as usize).to_vec() };
    unsafe { LocalFree(out.pbData as _) };
    Ok(v)
}

fn unprotect(cipher: &[u8]) -> Option<Vec<u8>> {
    let input = blob(cipher);
    let entropy = blob(ENTROPY);
    let mut out = CRYPT_INTEGER_BLOB { cbData: 0, pbData: std::ptr::null_mut() };
    let ok = unsafe { CryptUnprotectData(&input, std::ptr::null_mut(), &entropy, std::ptr::null(), std::ptr::null(), 0, &mut out) };
    if ok == 0 {
        return None;
    }
    let v = unsafe { std::slice::from_raw_parts(out.pbData, out.cbData as usize).to_vec() };
    unsafe { LocalFree(out.pbData as _) };
    Some(v)
}

pub fn get(key: &str) -> Option<String> {
    let bytes = std::fs::read(path(key)).ok()?;
    String::from_utf8(unprotect(&bytes)?).ok()
}

pub fn set(key: &str, value: &str) -> Result<(), String> {
    std::fs::create_dir_all(dir()).map_err(|e| e.to_string())?;
    let enc = protect(value.as_bytes())?;
    let p = path(key);
    let tmp = p.with_extension("tmp");
    std::fs::write(&tmp, enc).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &p).map_err(|e| e.to_string())
}

pub fn remove(key: &str) {
    let _ = std::fs::remove_file(path(key));
}

pub fn clear_all() {
    let _ = std::fs::remove_dir_all(dir());
}
