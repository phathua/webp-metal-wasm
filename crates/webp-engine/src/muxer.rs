//! WebP / RIFF container parsing and verification utilities.

/// WebP Format Type
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WebpFormat {
    LosslessVp8l,
    LossyVp8,
    ExtendedVp8x,
    Unknown,
}

/// Metadata extracted from a WebP header
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WebpHeaderInfo {
    pub file_size: u32,
    pub format: WebpFormat,
    pub has_alpha: bool,
}

/// Error type for WebP container parsing
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MuxerError {
    BufferTooShort,
    InvalidRiffHeader,
    InvalidWebpSignature,
    UnknownFormat,
}

/// Validates that a byte buffer contains a valid WebP container
/// and extracts format information.
pub fn parse_webp_header(data: &[u8]) -> Result<WebpHeaderInfo, MuxerError> {
    if data.len() < 16 {
        return Err(MuxerError::BufferTooShort);
    }

    if &data[0..4] != b"RIFF" {
        return Err(MuxerError::InvalidRiffHeader);
    }

    let file_size = u32::from_le_bytes([data[4], data[5], data[6], data[7]]);

    if &data[8..12] != b"WEBP" {
        return Err(MuxerError::InvalidWebpSignature);
    }

    let chunk_tag = &data[12..16];
    let (format, has_alpha) = if chunk_tag == b"VP8L" {
        (WebpFormat::LosslessVp8l, true)
    } else if chunk_tag == b"VP8 " {
        (WebpFormat::LossyVp8, false)
    } else if chunk_tag == b"VP8X" {
        let alpha = if data.len() > 20 {
            (data[20] & 0x10) != 0
        } else {
            false
        };
        (WebpFormat::ExtendedVp8x, alpha)
    } else {
        (WebpFormat::Unknown, false)
    };

    Ok(WebpHeaderInfo {
        file_size,
        format,
        has_alpha,
    })
}

/// Helper to verify if data is valid Lossless VP8L WebP
pub fn is_lossless_webp(data: &[u8]) -> bool {
    matches!(parse_webp_header(data), Ok(info) if info.format == WebpFormat::LosslessVp8l)
}

/// Helper to verify if data is valid Lossy VP8 WebP (either simple VP8 or VP8X with VP8)
pub fn is_lossy_webp(data: &[u8]) -> bool {
    match parse_webp_header(data) {
        Ok(info) => {
            info.format == WebpFormat::LossyVp8
                || (info.format == WebpFormat::ExtendedVp8x && data.windows(4).any(|w| w == b"VP8 "))
        }
        Err(_) => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_valid_vp8l() {
        let mut data = vec![0u8; 30];
        data[0..4].copy_from_slice(b"RIFF");
        data[4..8].copy_from_slice(&22u32.to_le_bytes());
        data[8..12].copy_from_slice(b"WEBP");
        data[12..16].copy_from_slice(b"VP8L");

        let info = parse_webp_header(&data).expect("Valid VP8L header");
        assert_eq!(info.format, WebpFormat::LosslessVp8l);
        assert_eq!(info.file_size, 22);
        assert!(info.has_alpha);
        assert!(is_lossless_webp(&data));
        assert!(!is_lossy_webp(&data));
    }

    #[test]
    fn test_parse_valid_vp8() {
        let mut data = vec![0u8; 30];
        data[0..4].copy_from_slice(b"RIFF");
        data[4..8].copy_from_slice(&22u32.to_le_bytes());
        data[8..12].copy_from_slice(b"WEBP");
        data[12..16].copy_from_slice(b"VP8 ");

        let info = parse_webp_header(&data).expect("Valid VP8 header");
        assert_eq!(info.format, WebpFormat::LossyVp8);
        assert_eq!(info.file_size, 22);
        assert!(!info.has_alpha);
        assert!(!is_lossless_webp(&data));
        assert!(is_lossy_webp(&data));
    }

    #[test]
    fn test_parse_invalid_headers() {
        let short = vec![0u8; 10];
        assert_eq!(parse_webp_header(&short), Err(MuxerError::BufferTooShort));

        let mut invalid_riff = vec![0u8; 20];
        invalid_riff[0..4].copy_from_slice(b"FORM");
        assert_eq!(
            parse_webp_header(&invalid_riff),
            Err(MuxerError::InvalidRiffHeader)
        );

        let mut invalid_webp = vec![0u8; 20];
        invalid_webp[0..4].copy_from_slice(b"RIFF");
        invalid_webp[8..12].copy_from_slice(b"AVIF");
        assert_eq!(
            parse_webp_header(&invalid_webp),
            Err(MuxerError::InvalidWebpSignature)
        );
    }
}
