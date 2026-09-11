//! WebP Encoding Dispatcher (Lossless VP8L and Lossy VP8)

use webp_rust::encoder::{
    encode_lossless_rgba_to_webp, encode_lossy_rgba_to_webp_with_config, LossyEncodingConfig,
};

/// Error conditions during encoding operations
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WebpEncodeError {
    InvalidDimensions,
    DimensionOverflow,
    BufferLengthMismatch { expected: usize, actual: usize },
    InvalidQuality,
    EncodingFailed,
}

/// Dispatches lossless WebP encoding for an RGBA buffer.
///
/// Preserves 100% pixel fidelity and full alpha channel.
pub fn encode_lossless(
    width: u32,
    height: u32,
    rgba: &[u8],
) -> Result<Vec<u8>, WebpEncodeError> {
    if width == 0 || height == 0 {
        return Err(WebpEncodeError::InvalidDimensions);
    }

    let pixel_count = (width as usize)
        .checked_mul(height as usize)
        .ok_or(WebpEncodeError::DimensionOverflow)?;
    let expected_len = pixel_count
        .checked_mul(4)
        .ok_or(WebpEncodeError::DimensionOverflow)?;

    if rgba.len() != expected_len {
        return Err(WebpEncodeError::BufferLengthMismatch {
            expected: expected_len,
            actual: rgba.len(),
        });
    }

    encode_lossless_rgba_to_webp(width as usize, height as usize, rgba)
        .map_err(|_| WebpEncodeError::EncodingFailed)
}

/// Dispatches lossy WebP encoding for an RGBA buffer.
///
/// Compresses via VP8 / YUV420 planar transform with adjustable quality (1.0 to 100.0).
pub fn encode_lossy(
    width: u32,
    height: u32,
    rgba: &[u8],
    quality: f32,
) -> Result<Vec<u8>, WebpEncodeError> {
    if width == 0 || height == 0 {
        return Err(WebpEncodeError::InvalidDimensions);
    }

    if !(1.0..=100.0).contains(&quality) {
        return Err(WebpEncodeError::InvalidQuality);
    }

    let pixel_count = (width as usize)
        .checked_mul(height as usize)
        .ok_or(WebpEncodeError::DimensionOverflow)?;
    let expected_len = pixel_count
        .checked_mul(4)
        .ok_or(WebpEncodeError::DimensionOverflow)?;

    if rgba.len() != expected_len {
        return Err(WebpEncodeError::BufferLengthMismatch {
            expected: expected_len,
            actual: rgba.len(),
        });
    }

    let config = LossyEncodingConfig {
        quality,
        ..Default::default()
    };

    encode_lossy_rgba_to_webp_with_config(width as usize, height as usize, rgba, &config)
        .map_err(|_| WebpEncodeError::EncodingFailed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::muxer::{is_lossless_webp, is_lossy_webp};

    #[test]
    fn test_lossless_roundtrip_header() {
        let width = 4u32;
        let height = 4u32;
        let rgba = vec![255u8; (width * height * 4) as usize];

        let result = encode_lossless(width, height, &rgba).expect("Encoding should succeed");
        assert!(result.len() > 12);
        assert!(is_lossless_webp(&result));
    }

    #[test]
    fn test_lossy_roundtrip_header() {
        let width = 16u32;
        let height = 16u32;
        let rgba = vec![128u8; (width * height * 4) as usize];

        let result = encode_lossy(width, height, &rgba, 80.0).expect("Encoding should succeed");
        assert!(result.len() > 12);
        assert!(is_lossy_webp(&result));
    }

    #[test]
    fn test_invalid_dimensions_and_quality() {
        let dummy = [0u8; 16];
        assert_eq!(
            encode_lossless(0, 1, &dummy),
            Err(WebpEncodeError::InvalidDimensions)
        );
        assert_eq!(
            encode_lossless(1, 0, &dummy),
            Err(WebpEncodeError::InvalidDimensions)
        );
        assert_eq!(
            encode_lossy(2, 2, &dummy, 0.0),
            Err(WebpEncodeError::InvalidQuality)
        );
        assert_eq!(
            encode_lossy(2, 2, &dummy, 100.5),
            Err(WebpEncodeError::InvalidQuality)
        );
    }
}
