//! Adversarial Stress and Fuzzing Test Suite
//!
//! Empirical validation of boundary dimensions, out-of-bounds parameters,
//! memory stability, and container integrity.

use std::slice;
use webp_engine::{
    alloc_buffer, encode_lossless_webp, encode_lossy_webp, free_buffer,
    muxer::{is_lossless_webp, is_lossy_webp, parse_webp_header},
    ERR_DIMENSION_OVERFLOW, ERR_ENCODING_FAILED, ERR_INVALID_DIMENSIONS, ERR_INVALID_QUALITY,
    ERR_SUCCESS,
};

#[test]
fn test_adversarial_zero_dimensions() {
    let mut out_ptr: *mut u8 = std::ptr::null_mut();
    let mut out_len: usize = 0;
    let dummy = [0u8; 64];

    unsafe {
        // Zero x Zero
        assert_eq!(
            encode_lossless_webp(dummy.as_ptr(), 0, 0, &mut out_ptr, &mut out_len),
            ERR_INVALID_DIMENSIONS
        );
        assert_eq!(
            encode_lossy_webp(dummy.as_ptr(), 0, 0, 80.0, &mut out_ptr, &mut out_len),
            ERR_INVALID_DIMENSIONS
        );

        // Zero x Non-zero
        assert_eq!(
            encode_lossless_webp(dummy.as_ptr(), 0, 10, &mut out_ptr, &mut out_len),
            ERR_INVALID_DIMENSIONS
        );
        assert_eq!(
            encode_lossy_webp(dummy.as_ptr(), 0, 10, 80.0, &mut out_ptr, &mut out_len),
            ERR_INVALID_DIMENSIONS
        );

        // Non-zero x Zero
        assert_eq!(
            encode_lossless_webp(dummy.as_ptr(), 10, 0, &mut out_ptr, &mut out_len),
            ERR_INVALID_DIMENSIONS
        );
        assert_eq!(
            encode_lossy_webp(dummy.as_ptr(), 10, 0, 80.0, &mut out_ptr, &mut out_len),
            ERR_INVALID_DIMENSIONS
        );
    }
}

#[test]
fn test_adversarial_minimal_1x1_and_odd_dimensions() {
    let mut out_ptr: *mut u8 = std::ptr::null_mut();
    let mut out_len: usize = 0;

    // 1x1 Lossless
    let pixel_1x1 = [255u8, 128u8, 64u8, 200u8];
    unsafe {
        let code = encode_lossless_webp(pixel_1x1.as_ptr(), 1, 1, &mut out_ptr, &mut out_len);
        assert_eq!(code, ERR_SUCCESS);
        assert!(!out_ptr.is_null());
        assert!(out_len > 12);
        let webp_slice = slice::from_raw_parts(out_ptr, out_len);
        assert!(is_lossless_webp(webp_slice));
        free_buffer(out_ptr, out_len);
    }

    // 1x1 Lossy
    unsafe {
        let code = encode_lossy_webp(pixel_1x1.as_ptr(), 1, 1, 80.0, &mut out_ptr, &mut out_len);
        assert_eq!(code, ERR_SUCCESS);
        assert!(!out_ptr.is_null());
        assert!(out_len > 12);
        let webp_slice = slice::from_raw_parts(out_ptr, out_len);
        assert!(is_lossy_webp(webp_slice));
        free_buffer(out_ptr, out_len);
    }

    // Odd non-macroblock dimensions: 3x5, 7x13, 15x15
    for &(w, h) in &[(3, 5), (7, 13), (15, 15), (33, 47)] {
        let size = (w * h * 4) as usize;
        let pixels = vec![180u8; size];

        unsafe {
            let code_l = encode_lossless_webp(pixels.as_ptr(), w, h, &mut out_ptr, &mut out_len);
            assert_eq!(code_l, ERR_SUCCESS, "Lossless failed on {}x{}", w, h);
            assert!(is_lossless_webp(slice::from_raw_parts(out_ptr, out_len)));
            free_buffer(out_ptr, out_len);

            let code_ly = encode_lossy_webp(pixels.as_ptr(), w, h, 75.0, &mut out_ptr, &mut out_len);
            assert_eq!(code_ly, ERR_SUCCESS, "Lossy failed on {}x{}", w, h);
            assert!(is_lossy_webp(slice::from_raw_parts(out_ptr, out_len)));
            free_buffer(out_ptr, out_len);
        }
    }
}

#[test]
fn test_adversarial_extreme_aspect_ratios() {
    let mut out_ptr: *mut u8 = std::ptr::null_mut();
    let mut out_len: usize = 0;

    // 1x4096 (extreme tall)
    let tall = vec![255u8; 1 * 4096 * 4];
    unsafe {
        let res = encode_lossless_webp(tall.as_ptr(), 1, 4096, &mut out_ptr, &mut out_len);
        assert_eq!(res, ERR_SUCCESS);
        assert!(is_lossless_webp(slice::from_raw_parts(out_ptr, out_len)));
        free_buffer(out_ptr, out_len);

        let res_ly = encode_lossy_webp(tall.as_ptr(), 1, 4096, 80.0, &mut out_ptr, &mut out_len);
        assert_eq!(res_ly, ERR_SUCCESS);
        assert!(is_lossy_webp(slice::from_raw_parts(out_ptr, out_len)));
        free_buffer(out_ptr, out_len);
    }

    // 4096x1 (extreme wide)
    let wide = vec![255u8; 4096 * 1 * 4];
    unsafe {
        let res = encode_lossless_webp(wide.as_ptr(), 4096, 1, &mut out_ptr, &mut out_len);
        assert_eq!(res, ERR_SUCCESS);
        assert!(is_lossless_webp(slice::from_raw_parts(out_ptr, out_len)));
        free_buffer(out_ptr, out_len);

        let res_ly = encode_lossy_webp(wide.as_ptr(), 4096, 1, 80.0, &mut out_ptr, &mut out_len);
        assert_eq!(res_ly, ERR_SUCCESS);
        assert!(is_lossy_webp(slice::from_raw_parts(out_ptr, out_len)));
        free_buffer(out_ptr, out_len);
    }
}

#[test]
fn test_adversarial_integer_overflow_prevention() {
    let mut out_ptr: *mut u8 = std::ptr::null_mut();
    let mut out_len: usize = 0;
    let dummy = [0u8; 64];

    unsafe {
        // u32::MAX dimensions
        assert_eq!(
            encode_lossless_webp(dummy.as_ptr(), u32::MAX, u32::MAX, &mut out_ptr, &mut out_len),
            ERR_DIMENSION_OVERFLOW
        );
        let code_max_1 = encode_lossless_webp(dummy.as_ptr(), u32::MAX, 1, &mut out_ptr, &mut out_len);
        assert!(
            code_max_1 == ERR_DIMENSION_OVERFLOW || code_max_1 == ERR_ENCODING_FAILED,
            "Expected dimension overflow or encoding failure on MAX x 1, got {}", code_max_1
        );
        let code_1_max = encode_lossless_webp(dummy.as_ptr(), 1, u32::MAX, &mut out_ptr, &mut out_len);
        assert!(
            code_1_max == ERR_DIMENSION_OVERFLOW || code_1_max == ERR_ENCODING_FAILED,
            "Expected dimension overflow or encoding failure on 1 x MAX, got {}", code_1_max
        );

        // 65536 x 65536: 2^16 * 2^16 = 2^32
        // On 32-bit WASM: overflows usize -> ERR_DIMENSION_OVERFLOW (-4)
        // On 64-bit host: fits in 64-bit usize -> webp-rust rejects invalid WebP dimension -> ERR_ENCODING_FAILED (-5)
        let code_65k = encode_lossless_webp(dummy.as_ptr(), 65536, 65536, &mut out_ptr, &mut out_len);
        assert!(
            code_65k == ERR_DIMENSION_OVERFLOW || code_65k == ERR_ENCODING_FAILED,
            "Expected dimension overflow or encoding failure, got {}", code_65k
        );

        // Lossy equivalents
        assert_eq!(
            encode_lossy_webp(dummy.as_ptr(), u32::MAX, u32::MAX, 80.0, &mut out_ptr, &mut out_len),
            ERR_DIMENSION_OVERFLOW
        );
        let code_lossy_max = encode_lossy_webp(dummy.as_ptr(), u32::MAX, 2, 80.0, &mut out_ptr, &mut out_len);
        assert!(
            code_lossy_max == ERR_DIMENSION_OVERFLOW || code_lossy_max == ERR_ENCODING_FAILED,
            "Expected dimension overflow or encoding failure on Lossy MAX x 2, got {}", code_lossy_max
        );
        let code_lossy_65k = encode_lossy_webp(dummy.as_ptr(), 65536, 65536, 80.0, &mut out_ptr, &mut out_len);
        assert!(
            code_lossy_65k == ERR_DIMENSION_OVERFLOW || code_lossy_65k == ERR_ENCODING_FAILED,
            "Expected dimension overflow or encoding failure, got {}", code_lossy_65k
        );
    }
}

#[test]
fn test_adversarial_quality_boundaries() {
    let mut out_ptr: *mut u8 = std::ptr::null_mut();
    let mut out_len: usize = 0;
    let pixels = [128u8; 64]; // 4x4 image

    unsafe {
        // Below 1.0
        assert_eq!(
            encode_lossy_webp(pixels.as_ptr(), 4, 4, 0.0, &mut out_ptr, &mut out_len),
            ERR_INVALID_QUALITY
        );
        assert_eq!(
            encode_lossy_webp(pixels.as_ptr(), 4, 4, -10.0, &mut out_ptr, &mut out_len),
            ERR_INVALID_QUALITY
        );
        assert_eq!(
            encode_lossy_webp(pixels.as_ptr(), 4, 4, 0.999, &mut out_ptr, &mut out_len),
            ERR_INVALID_QUALITY
        );

        // Above 100.0
        assert_eq!(
            encode_lossy_webp(pixels.as_ptr(), 4, 4, 100.001, &mut out_ptr, &mut out_len),
            ERR_INVALID_QUALITY
        );
        assert_eq!(
            encode_lossy_webp(pixels.as_ptr(), 4, 4, 105.0, &mut out_ptr, &mut out_len),
            ERR_INVALID_QUALITY
        );

        // Special floats: NaN, Infinity
        assert_eq!(
            encode_lossy_webp(pixels.as_ptr(), 4, 4, f32::NAN, &mut out_ptr, &mut out_len),
            ERR_INVALID_QUALITY
        );
        assert_eq!(
            encode_lossy_webp(pixels.as_ptr(), 4, 4, f32::INFINITY, &mut out_ptr, &mut out_len),
            ERR_INVALID_QUALITY
        );
        assert_eq!(
            encode_lossy_webp(pixels.as_ptr(), 4, 4, f32::NEG_INFINITY, &mut out_ptr, &mut out_len),
            ERR_INVALID_QUALITY
        );

        // Valid boundary limits: 1.0 and 100.0
        assert_eq!(
            encode_lossy_webp(pixels.as_ptr(), 4, 4, 1.0, &mut out_ptr, &mut out_len),
            ERR_SUCCESS
        );
        free_buffer(out_ptr, out_len);

        assert_eq!(
            encode_lossy_webp(pixels.as_ptr(), 4, 4, 100.0, &mut out_ptr, &mut out_len),
            ERR_SUCCESS
        );
        free_buffer(out_ptr, out_len);
    }
}

#[test]
fn test_adversarial_memory_endurance_500_cycles() {
    let mut out_ptr: *mut u8 = std::ptr::null_mut();
    let mut out_len: usize = 0;

    let dimensions = [(16, 16), (32, 32), (64, 32), (48, 48), (33, 47)];

    for i in 0..500 {
        let (w, h) = dimensions[i % dimensions.len()];
        let size = (w * h * 4) as usize;
        let buf = alloc_buffer(size);
        assert!(!buf.is_null());

        unsafe {
            // Fill with test pattern
            for b in 0..size {
                *buf.add(b) = ((b * 7 + i) % 256) as u8;
            }

            let res = if i % 2 == 0 {
                encode_lossless_webp(buf, w, h, &mut out_ptr, &mut out_len)
            } else {
                let quality = 50.0 + ((i % 50) as f32);
                encode_lossy_webp(buf, w, h, quality, &mut out_ptr, &mut out_len)
            };

            assert_eq!(res, ERR_SUCCESS, "Iteration {} failed", i);
            assert!(!out_ptr.is_null());
            assert!(out_len > 12);

            let out_slice = slice::from_raw_parts(out_ptr, out_len);
            let info = parse_webp_header(out_slice).expect("Valid WebP header");
            assert!(info.file_size > 0);

            free_buffer(out_ptr, out_len);
            free_buffer(buf, size);
        }
    }
}
