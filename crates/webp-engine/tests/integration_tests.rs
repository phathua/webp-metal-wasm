//! Integration tests for webp_engine crate

use std::slice;
use webp_engine::{
    alloc_buffer, create_webm_video, encode_lossless_webp, encode_lossy_webp, free_buffer,
    muxer::{is_lossless_webp, is_lossy_webp, parse_webp_header, WebpFormat},
    ERR_DIMENSION_OVERFLOW, ERR_INVALID_DIMENSIONS, ERR_INVALID_QUALITY, ERR_NOT_IMPLEMENTED,
    ERR_NULL_POINTER, ERR_SUCCESS,
};

#[test]
fn test_integration_memory_lifecycle() {
    let size = 65536;
    let ptr = alloc_buffer(size);
    assert!(!ptr.is_null());

    unsafe {
        for i in 0..size {
            *ptr.add(i) = (i % 256) as u8;
        }
        for i in 0..size {
            assert_eq!(*ptr.add(i), (i % 256) as u8);
        }
        free_buffer(ptr, size);
    }
}

#[test]
fn test_integration_lossless_alpha_preservation() {
    let width = 32u32;
    let height = 32u32;
    let mut pixels = vec![0u8; (width * height * 4) as usize];

    // Diagonal alpha gradient
    for y in 0..height {
        for x in 0..width {
            let idx = ((y * width + x) * 4) as usize;
            pixels[idx] = 255;
            pixels[idx + 1] = 128;
            pixels[idx + 2] = 64;
            pixels[idx + 3] = ((x * 8) % 256) as u8; // Alpha varies
        }
    }

    let mut out_ptr: *mut u8 = std::ptr::null_mut();
    let mut out_len: usize = 0;

    let res = unsafe {
        encode_lossless_webp(
            pixels.as_ptr(),
            width,
            height,
            &mut out_ptr,
            &mut out_len,
        )
    };

    assert_eq!(res, ERR_SUCCESS);
    assert!(!out_ptr.is_null());
    assert!(out_len > 12);

    let webp_slice = unsafe { slice::from_raw_parts(out_ptr, out_len) };
    let info = parse_webp_header(webp_slice).expect("Valid WebP header");
    assert_eq!(info.format, WebpFormat::LosslessVp8l);
    assert!(info.has_alpha);
    assert!(is_lossless_webp(webp_slice));

    unsafe {
        free_buffer(out_ptr, out_len);
    }
}

#[test]
fn test_integration_lossy_opaque_and_alpha() {
    let width = 16u32;
    let height = 16u32;

    // 1. Opaque image -> VP8 chunk
    let mut opaque_pixels = vec![255u8; (width * height * 4) as usize];
    for y in 0..height {
        for x in 0..width {
            let idx = ((y * width + x) * 4) as usize;
            opaque_pixels[idx] = (x * 15) as u8;
            opaque_pixels[idx + 1] = (y * 15) as u8;
            opaque_pixels[idx + 2] = 200;
            opaque_pixels[idx + 3] = 255; // Fully opaque
        }
    }

    let mut out_ptr: *mut u8 = std::ptr::null_mut();
    let mut out_len: usize = 0;

    let res = unsafe {
        encode_lossy_webp(
            opaque_pixels.as_ptr(),
            width,
            height,
            80.0,
            &mut out_ptr,
            &mut out_len,
        )
    };
    assert_eq!(res, ERR_SUCCESS);
    let webp_slice = unsafe { slice::from_raw_parts(out_ptr, out_len) };
    let info = parse_webp_header(webp_slice).expect("Valid WebP header");
    assert!(info.format == WebpFormat::LossyVp8 || info.format == WebpFormat::ExtendedVp8x);
    assert!(is_lossy_webp(webp_slice));
    unsafe {
        free_buffer(out_ptr, out_len);
    }

    // 2. Translucent image -> VP8X + ALPH + VP8
    let mut alpha_pixels = opaque_pixels.clone();
    for i in 0..(width * height) as usize {
        alpha_pixels[i * 4 + 3] = 120; // Alpha < 255
    }

    let res = unsafe {
        encode_lossy_webp(
            alpha_pixels.as_ptr(),
            width,
            height,
            80.0,
            &mut out_ptr,
            &mut out_len,
        )
    };
    assert_eq!(res, ERR_SUCCESS);
    let webp_slice = unsafe { slice::from_raw_parts(out_ptr, out_len) };
    let info = parse_webp_header(webp_slice).expect("Valid WebP header");
    assert_eq!(info.format, WebpFormat::ExtendedVp8x);
    assert!(info.has_alpha);
    assert!(is_lossy_webp(webp_slice));
    unsafe {
        free_buffer(out_ptr, out_len);
    }
}

#[test]
fn test_integration_error_robustness() {
    let mut out_ptr: *mut u8 = std::ptr::null_mut();
    let mut out_len: usize = 0;
    let dummy = [0u8; 64];

    unsafe {
        assert_eq!(
            encode_lossless_webp(std::ptr::null(), 4, 4, &mut out_ptr, &mut out_len),
            ERR_NULL_POINTER
        );
        assert_eq!(
            encode_lossless_webp(dummy.as_ptr(), 0, 4, &mut out_ptr, &mut out_len),
            ERR_INVALID_DIMENSIONS
        );
        assert_eq!(
            encode_lossy_webp(dummy.as_ptr(), 4, 4, 0.0, &mut out_ptr, &mut out_len),
            ERR_INVALID_QUALITY
        );
        assert_eq!(
            encode_lossy_webp(dummy.as_ptr(), 4, 4, 105.0, &mut out_ptr, &mut out_len),
            ERR_INVALID_QUALITY
        );
        assert_eq!(
            encode_lossless_webp(dummy.as_ptr(), u32::MAX, u32::MAX, &mut out_ptr, &mut out_len),
            ERR_DIMENSION_OVERFLOW
        );
        assert_eq!(
            create_webm_video(dummy.as_ptr(), dummy.len(), 100, 100, 30, &mut out_ptr, &mut out_len),
            ERR_NOT_IMPLEMENTED
        );
    }
}
