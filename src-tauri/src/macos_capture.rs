use std::{
    ffi::{CStr, CString},
    os::raw::{c_char, c_int, c_void},
    path::Path,
};

const ERROR_BUFFER_LENGTH: usize = 1024;

#[repr(C)]
#[derive(Debug, Default)]
struct NativeCaptureMetadata {
    pixel_width: usize,
    pixel_height: usize,
}

#[derive(Debug)]
pub struct CaptureMetadata {
    pub pixel_width: usize,
    pub pixel_height: usize,
}

unsafe extern "C" {
    fn ost_has_screen_capture_permission() -> bool;
    fn ost_request_screen_capture_permission() -> bool;
    fn ost_configure_capture_window(window_pointer: *mut c_void);
    fn ost_present_capture_window(window_pointer: *mut c_void);
    fn ost_configure_result_window(window_pointer: *mut c_void);
    fn ost_copy_text_to_clipboard(text: *const c_char) -> bool;
    fn ost_capture_display_png(
        output_path: *const c_char,
        metadata: *mut NativeCaptureMetadata,
        error_buffer: *mut c_char,
        error_buffer_length: usize,
    ) -> c_int;
    fn ost_crop_and_recognize_text(
        input_path: *const c_char,
        crop_output_path: *const c_char,
        text_output_path: *const c_char,
        crop_x: f64,
        crop_y: f64,
        crop_width: f64,
        crop_height: f64,
        error_buffer: *mut c_char,
        error_buffer_length: usize,
    ) -> c_int;
}

pub fn has_permission() -> bool {
    unsafe { ost_has_screen_capture_permission() }
}

pub fn request_permission() -> bool {
    unsafe { ost_request_screen_capture_permission() }
}

pub fn configure_capture_window(window_pointer: *mut c_void) {
    unsafe { ost_configure_capture_window(window_pointer) }
}

pub fn present_capture_window(window_pointer: *mut c_void) {
    unsafe { ost_present_capture_window(window_pointer) }
}

pub fn configure_result_window(window_pointer: *mut c_void) {
    unsafe { ost_configure_result_window(window_pointer) }
}

pub fn copy_text_to_clipboard(text: &str) -> Result<(), String> {
    let text = CString::new(text).map_err(|_| "复制内容包含不支持的空字符".to_string())?;
    if unsafe { ost_copy_text_to_clipboard(text.as_ptr()) } {
        Ok(())
    } else {
        Err("无法写入系统剪贴板".to_string())
    }
}

fn path_to_c_string(path: &Path) -> Result<CString, String> {
    CString::new(path.to_string_lossy().as_bytes())
        .map_err(|_| "native file path contains an invalid null byte".to_string())
}

pub fn capture_display_to_png(path: &Path) -> Result<CaptureMetadata, String> {
    let path = path_to_c_string(path)?;
    let mut native_metadata = NativeCaptureMetadata::default();
    let mut error_buffer = [0 as c_char; ERROR_BUFFER_LENGTH];

    let result = unsafe {
        ost_capture_display_png(
            path.as_ptr(),
            &mut native_metadata,
            error_buffer.as_mut_ptr(),
            error_buffer.len(),
        )
    };

    if result != 0 {
        let native_message = unsafe { CStr::from_ptr(error_buffer.as_ptr()) }
            .to_string_lossy()
            .into_owned();
        let message = if native_message.is_empty() {
            format!("native screen capture failed with code {result}")
        } else {
            native_message
        };
        return Err(message);
    }

    Ok(CaptureMetadata {
        pixel_width: native_metadata.pixel_width,
        pixel_height: native_metadata.pixel_height,
    })
}

pub fn crop_and_recognize_text(
    input_path: &Path,
    crop_output_path: &Path,
    text_output_path: &Path,
    crop_rect: [f64; 4],
) -> Result<(), String> {
    let input_path = path_to_c_string(input_path)?;
    let crop_output_path = path_to_c_string(crop_output_path)?;
    let text_output_path = path_to_c_string(text_output_path)?;
    let mut error_buffer = [0 as c_char; ERROR_BUFFER_LENGTH];

    let result = unsafe {
        ost_crop_and_recognize_text(
            input_path.as_ptr(),
            crop_output_path.as_ptr(),
            text_output_path.as_ptr(),
            crop_rect[0],
            crop_rect[1],
            crop_rect[2],
            crop_rect[3],
            error_buffer.as_mut_ptr(),
            error_buffer.len(),
        )
    };

    if result != 0 {
        let native_message = unsafe { CStr::from_ptr(error_buffer.as_ptr()) }
            .to_string_lossy()
            .into_owned();
        return Err(if native_message.is_empty() {
            format!("native OCR failed with code {result}")
        } else {
            native_message
        });
    }

    Ok(())
}
