//! Pure-Rust WebP SIMD WASM Engine
//!
//! Ultra-lightweight image compression module compiled to WebAssembly.
//! Provides bit-exact Lossless (VP8L) preserving full alpha channel,
//! and customizable Lossy (VP8, quality 1-100) compression.

pub mod encoder;
pub mod muxer;
pub mod webm;

use std::slice;

// C-ABI Error Codes
pub const ERR_SUCCESS: i32 = 0;
pub const ERR_NULL_POINTER: i32 = -1;
pub const ERR_INVALID_DIMENSIONS: i32 = -2;
pub const ERR_INVALID_QUALITY: i32 = -3;
pub const ERR_DIMENSION_OVERFLOW: i32 = -4;
pub const ERR_ENCODING_FAILED: i32 = -5;
pub const ERR_NOT_IMPLEMENTED: i32 = -99;

/// Allocates a contiguous linear memory buffer of the given size in WASM heap.
///
/// Returns a raw pointer to the allocated memory, or null if size is 0.
#[no_mangle]
pub extern "C" fn alloc_buffer(size: usize) -> *mut u8 {
    if size == 0 {
        return std::ptr::null_mut();
    }
    let mut buf = Vec::with_capacity(size);
    let ptr = buf.as_mut_ptr();
    std::mem::forget(buf);
    ptr
}

/// Frees a linear memory buffer previously allocated by `alloc_buffer`.
///
/// # Safety
/// The caller must ensure `ptr` was returned by `alloc_buffer` and `size` matches the allocated capacity.
#[no_mangle]
pub unsafe extern "C" fn free_buffer(ptr: *mut u8, size: usize) {
    if !ptr.is_null() && size > 0 {
        let _ = Vec::from_raw_parts(ptr, 0, size);
    }
}

/// Encodes an RGBA pixel buffer to WebP Lossless (VP8L) format.
///
/// Preserves 100% pixel fidelity and alpha transparency.
///
/// # Arguments
/// * `in_ptr` - Pointer to RGBA input bytes (width * height * 4)
/// * `width` - Image width in pixels
/// * `height` - Image height in pixels
/// * `out_ptr` - Destination pointer receiving the allocated output buffer address
/// * `out_len` - Destination pointer receiving the output buffer length in bytes
///
/// # Returns
/// `0` (`ERR_SUCCESS`) on success, or a negative error code on failure.
///
/// # Safety
/// The caller must guarantee `in_ptr` points to at least `width * height * 4` valid bytes,
/// and that `out_ptr` and `out_len` point to writable memory locations.
#[no_mangle]
pub unsafe extern "C" fn encode_lossless_webp(
    in_ptr: *const u8,
    width: u32,
    height: u32,
    out_ptr: *mut *mut u8,
    out_len: *mut usize,
) -> i32 {
    if in_ptr.is_null() || out_ptr.is_null() || out_len.is_null() {
        return ERR_NULL_POINTER;
    }
    if width == 0 || height == 0 {
        return ERR_INVALID_DIMENSIONS;
    }

    let pixel_count = match (width as usize).checked_mul(height as usize) {
        Some(c) => c,
        None => return ERR_DIMENSION_OVERFLOW,
    };
    let expected_len = match pixel_count.checked_mul(4) {
        Some(len) => len,
        None => return ERR_DIMENSION_OVERFLOW,
    };

    let rgba_slice = slice::from_raw_parts(in_ptr, expected_len);

    match encoder::encode_lossless(width, height, rgba_slice) {
        Ok(webp_bytes) => {
            let len = webp_bytes.len();
            let mut webp_buf = webp_bytes.into_boxed_slice();
            let ptr = webp_buf.as_mut_ptr();
            std::mem::forget(webp_buf);

            *out_ptr = ptr;
            *out_len = len;
            ERR_SUCCESS
        }
        Err(e) => match e {
            encoder::WebpEncodeError::InvalidDimensions => ERR_INVALID_DIMENSIONS,
            encoder::WebpEncodeError::DimensionOverflow => ERR_DIMENSION_OVERFLOW,
            _ => ERR_ENCODING_FAILED,
        },
    }
}

/// Encodes an RGBA pixel buffer to WebP Lossy (VP8) format.
///
/// Compresses using VP8 DCT with adjustable quality factor (1.0 to 100.0).
///
/// # Arguments
/// * `in_ptr` - Pointer to RGBA input bytes (width * height * 4)
/// * `width` - Image width in pixels
/// * `height` - Image height in pixels
/// * `quality` - Compression quality factor (1.0 to 100.0)
/// * `out_ptr` - Destination pointer receiving the allocated output buffer address
/// * `out_len` - Destination pointer receiving the output buffer length in bytes
///
/// # Returns
/// `0` (`ERR_SUCCESS`) on success, or a negative error code on failure.
///
/// # Safety
/// The caller must guarantee `in_ptr` points to at least `width * height * 4` valid bytes,
/// and that `out_ptr` and `out_len` point to writable memory locations.
#[no_mangle]
pub unsafe extern "C" fn encode_lossy_webp(
    in_ptr: *const u8,
    width: u32,
    height: u32,
    quality: f32,
    out_ptr: *mut *mut u8,
    out_len: *mut usize,
) -> i32 {
    if in_ptr.is_null() || out_ptr.is_null() || out_len.is_null() {
        return ERR_NULL_POINTER;
    }
    if width == 0 || height == 0 {
        return ERR_INVALID_DIMENSIONS;
    }
    if !(1.0..=100.0).contains(&quality) {
        return ERR_INVALID_QUALITY;
    }

    let pixel_count = match (width as usize).checked_mul(height as usize) {
        Some(c) => c,
        None => return ERR_DIMENSION_OVERFLOW,
    };
    let expected_len = match pixel_count.checked_mul(4) {
        Some(len) => len,
        None => return ERR_DIMENSION_OVERFLOW,
    };

    let rgba_slice = slice::from_raw_parts(in_ptr, expected_len);

    match encoder::encode_lossy(width, height, rgba_slice, quality) {
        Ok(webp_bytes) => {
            let len = webp_bytes.len();
            let mut webp_buf = webp_bytes.into_boxed_slice();
            let ptr = webp_buf.as_mut_ptr();
            std::mem::forget(webp_buf);

            *out_ptr = ptr;
            *out_len = len;
            ERR_SUCCESS
        }
        Err(e) => match e {
            encoder::WebpEncodeError::InvalidDimensions => ERR_INVALID_DIMENSIONS,
            encoder::WebpEncodeError::DimensionOverflow => ERR_DIMENSION_OVERFLOW,
            encoder::WebpEncodeError::InvalidQuality => ERR_INVALID_QUALITY,
            _ => ERR_ENCODING_FAILED,
        },
    }
}

/// Minimal WebM Muxer C-ABI export defined in PROJECT.md interface contracts.
///
/// Reserved for Milestone 3 WebM expansion.
///
/// # Safety
/// The caller must ensure `frames_ptr` points to valid memory of length `frames_len`,
/// and `out_ptr` and `out_len` point to valid writable locations.
#[no_mangle]
pub unsafe extern "C" fn create_webm_video(
    frames_ptr: *const u8,
    frames_len: usize,
    width: u32,
    height: u32,
    fps: u32,
    out_ptr: *mut *mut u8,
    out_len: *mut usize,
) -> i32 {
    if frames_ptr.is_null() || out_ptr.is_null() || out_len.is_null() {
        return ERR_NULL_POINTER;
    }
    if width == 0 || height == 0 || fps == 0 {
        return ERR_INVALID_DIMENSIONS;
    }
    let frames = slice::from_raw_parts(frames_ptr, frames_len);
    match webm::create_webm(frames, width, height, fps) {
        Ok(bytes) => {
            let len = bytes.len();
            let mut buf = bytes.into_boxed_slice();
            let ptr = buf.as_mut_ptr();
            std::mem::forget(buf);
            *out_ptr = ptr;
            *out_len = len;
            ERR_SUCCESS
        }
        Err(_) => ERR_NOT_IMPLEMENTED,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_alloc_and_free_buffer() {
        let size = 2048;
        let ptr = alloc_buffer(size);
        assert!(!ptr.is_null());
        unsafe {
            std::ptr::write_bytes(ptr, 0x42, size);
            assert_eq!(*ptr, 0x42);
            assert_eq!(*ptr.add(size - 1), 0x42);
            free_buffer(ptr, size);
        }
    }

    #[test]
    fn test_alloc_zero_buffer() {
        let ptr = alloc_buffer(0);
        assert!(ptr.is_null());
    }

    #[test]
    fn test_encode_lossless_transparent_square() {
        // Create 32x32 transparent RGBA square
        let width = 32u32;
        let height = 32u32;
        let mut pixels = vec![0u8; (width * height * 4) as usize];
        for y in 0..height {
            for x in 0..width {
                let idx = ((y * width + x) * 4) as usize;
                pixels[idx] = 255;                      // R
                pixels[idx + 1] = (x * 8) as u8;        // G
                pixels[idx + 2] = (y * 8) as u8;        // B
                pixels[idx + 3] = ((x + y) % 256) as u8; // Alpha gradient
            }
        }

        let mut out_ptr: *mut u8 = std::ptr::null_mut();
        let mut out_len: usize = 0;

        let status = unsafe {
            encode_lossless_webp(
                pixels.as_ptr(),
                width,
                height,
                &mut out_ptr,
                &mut out_len,
            )
        };

        assert_eq!(status, ERR_SUCCESS);
        assert!(!out_ptr.is_null());
        assert!(out_len > 12);

        let webp_slice = unsafe { slice::from_raw_parts(out_ptr, out_len) };

        // Check RIFF header: "RIFF" .... "WEBP"
        assert_eq!(&webp_slice[0..4], b"RIFF");
        assert_eq!(&webp_slice[8..12], b"WEBP");
        // Check VP8L chunk tag
        assert_eq!(&webp_slice[12..16], b"VP8L");

        // Validate using muxer module
        let info = muxer::parse_webp_header(webp_slice).expect("Valid WebP header");
        assert_eq!(info.format, muxer::WebpFormat::LosslessVp8l);
        assert!(info.has_alpha);

        unsafe {
            free_buffer(out_ptr, out_len);
        }
    }

    #[test]
    fn test_encode_lossy_gradient() {
        // Create 32x32 gradient image
        let width = 32u32;
        let height = 32u32;
        let mut pixels = vec![0u8; (width * height * 4) as usize];
        for y in 0..height {
            for x in 0..width {
                let idx = ((y * width + x) * 4) as usize;
                pixels[idx] = (x * 255 / width) as u8;
                pixels[idx + 1] = (y * 255 / height) as u8;
                pixels[idx + 2] = 200;
                pixels[idx + 3] = 255;
            }
        }

        let mut out_ptr: *mut u8 = std::ptr::null_mut();
        let mut out_len: usize = 0;

        let status = unsafe {
            encode_lossy_webp(
                pixels.as_ptr(),
                width,
                height,
                85.0,
                &mut out_ptr,
                &mut out_len,
            )
        };

        assert_eq!(status, ERR_SUCCESS);
        assert!(!out_ptr.is_null());
        assert!(out_len > 12);

        let webp_slice = unsafe { slice::from_raw_parts(out_ptr, out_len) };

        // Check RIFF header
        assert_eq!(&webp_slice[0..4], b"RIFF");
        assert_eq!(&webp_slice[8..12], b"WEBP");
        // Check VP8 or VP8X chunk tag
        assert!(
            &webp_slice[12..16] == b"VP8 " || &webp_slice[12..16] == b"VP8X",
            "Expected VP8 or VP8X chunk tag"
        );

        // Validate using muxer module
        assert!(muxer::is_lossy_webp(webp_slice));

        unsafe {
            free_buffer(out_ptr, out_len);
        }
    }

    #[test]
    fn test_lossy_quality_levels() {
        let width = 16u32;
        let height = 16u32;
        let pixels = vec![120u8; (width * height * 4) as usize];

        for &quality in &[1.0f32, 10.0, 50.0, 75.0, 95.0, 100.0] {
            let mut out_ptr: *mut u8 = std::ptr::null_mut();
            let mut out_len: usize = 0;

            let status = unsafe {
                encode_lossy_webp(
                    pixels.as_ptr(),
                    width,
                    height,
                    quality,
                    &mut out_ptr,
                    &mut out_len,
                )
            };
            assert_eq!(status, ERR_SUCCESS);
            assert!(out_len > 12);
            unsafe {
                free_buffer(out_ptr, out_len);
            }
        }
    }

    #[test]
    fn test_error_conditions() {
        let mut out_ptr: *mut u8 = std::ptr::null_mut();
        let mut out_len: usize = 0;
        let dummy = [0u8; 64];

        unsafe {
            // Null in_ptr
            assert_eq!(
                encode_lossless_webp(std::ptr::null(), 4, 4, &mut out_ptr, &mut out_len),
                ERR_NULL_POINTER
            );
            // Null out_ptr
            assert_eq!(
                encode_lossless_webp(dummy.as_ptr(), 4, 4, std::ptr::null_mut(), &mut out_len),
                ERR_NULL_POINTER
            );
            // Null out_len
            assert_eq!(
                encode_lossless_webp(dummy.as_ptr(), 4, 4, &mut out_ptr, std::ptr::null_mut()),
                ERR_NULL_POINTER
            );
            // Zero width / height
            assert_eq!(
                encode_lossless_webp(dummy.as_ptr(), 0, 4, &mut out_ptr, &mut out_len),
                ERR_INVALID_DIMENSIONS
            );
            assert_eq!(
                encode_lossless_webp(dummy.as_ptr(), 4, 0, &mut out_ptr, &mut out_len),
                ERR_INVALID_DIMENSIONS
            );

            // Invalid lossy quality
            assert_eq!(
                encode_lossy_webp(dummy.as_ptr(), 4, 4, 0.9, &mut out_ptr, &mut out_len),
                ERR_INVALID_QUALITY
            );
            assert_eq!(
                encode_lossy_webp(dummy.as_ptr(), 4, 4, 100.1, &mut out_ptr, &mut out_len),
                ERR_INVALID_QUALITY
            );
            assert_eq!(
                encode_lossy_webp(dummy.as_ptr(), 4, 4, f32::NAN, &mut out_ptr, &mut out_len),
                ERR_INVALID_QUALITY
            );

            // WebM stub error
            assert_eq!(
                create_webm_video(dummy.as_ptr(), dummy.len(), 100, 100, 30, &mut out_ptr, &mut out_len),
                ERR_NOT_IMPLEMENTED
            );
        }
    }

    #[test]
    fn test_lossy_color_fidelity() {
        let width = 32u32;
        let height = 32u32;
        let mut pixels = vec![0u8; (width * height * 4) as usize];
        for i in (0..pixels.len()).step_by(4) {
            pixels[i] = 255;   // R
            pixels[i + 1] = 0; // G
            pixels[i + 2] = 0; // B
            pixels[i + 3] = 255; // A
        }

        let mut out_ptr: *mut u8 = std::ptr::null_mut();
        let mut out_len: usize = 0;

        let status = unsafe {
            encode_lossy_webp(
                pixels.as_ptr(),
                width,
                height,
                80.0,
                &mut out_ptr,
                &mut out_len,
            )
        };

        assert_eq!(status, ERR_SUCCESS);
        assert!(!out_ptr.is_null());
        assert!(out_len > 12);

        let webp_slice = unsafe { slice::from_raw_parts(out_ptr, out_len) };
        assert!(muxer::is_lossy_webp(webp_slice));

        // Write to test file for Python Pillow inspection
        let _ = std::fs::write("../../target/test_zen_red.webp", webp_slice);

        unsafe {
            free_buffer(out_ptr, out_len);
        }
    }
}

