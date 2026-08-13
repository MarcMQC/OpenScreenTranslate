fn main() {
    println!("cargo:rerun-if-changed=../VERSION");
    let version = std::fs::read_to_string("../VERSION")
        .expect("failed to read the project VERSION file")
        .trim()
        .to_string();
    let cargo_version = std::env::var("CARGO_PKG_VERSION").expect("CARGO_PKG_VERSION is missing");
    assert_eq!(
        version, cargo_version,
        "VERSION and src-tauri/Cargo.toml are inconsistent; run `npm run version:sync`"
    );
    println!("cargo:rustc-env=OST_VERSION={version}");

    println!("cargo:rerun-if-changed=Info.plist");

    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        cc::Build::new()
            .file("native/screen_capture.m")
            .flag("-fobjc-arc")
            .flag("-fblocks")
            .flag("-mmacosx-version-min=14.0")
            .compile("ost_screen_capture");

        println!("cargo:rustc-link-lib=framework=ScreenCaptureKit");
        println!("cargo:rustc-link-lib=framework=Vision");
        println!("cargo:rustc-link-lib=framework=AppKit");
        println!("cargo:rustc-link-lib=framework=CoreGraphics");
        println!("cargo:rustc-link-lib=framework=Foundation");
        println!("cargo:rustc-link-lib=framework=ImageIO");
        println!("cargo:rustc-link-lib=framework=QuartzCore");
        println!("cargo:rerun-if-changed=native/screen_capture.m");
    }

    tauri_build::build()
}
