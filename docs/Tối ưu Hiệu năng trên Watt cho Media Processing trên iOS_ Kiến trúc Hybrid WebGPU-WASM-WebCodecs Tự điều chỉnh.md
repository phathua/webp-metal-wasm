# Tối ưu Hiệu năng trên Watt cho Media Processing trên iOS: Kiến trúc Hybrid WebGPU-WASM-WebCodecs Tự điều chỉnh

## Tổng Quan Chiến Lược và Kiến trúc Đề Xuất Phân Lớp

Trong bối cảnh web di động ngày càng đòi hỏi các ứng dụng xử lý phương tiện phức tạp ngay tại trình duyệt, việc thiết kế một kiến trúc phía client (client-side) tối ưu cho nền tảng iOS/iPadOS trở thành một thách thức kỹ thuật lớn. Yêu cầu không chỉ dừng lại ở việc đạt được hiệu suất cao, mà còn phải cân bằng chặt chẽ giữa độ trễ, tiêu thụ năng lượng, và hành vi nhiệt độ của thiết bị [[182](https://arxiv.org/html/2605.00519v1), [293](https://arxiv.org/pdf/2512.22180)]. Mục tiêu cốt lõi của nghiên cứu này là xác định một kiến trúc xử lý phương tiện phía client linh hoạt, có khả năng tự động lựa chọn đường dẫn xử lý tối ưu nhất dựa trên khả năng phần cứng và trình duyệt của từng thiết bị cụ thể, nhằm tối đa hóa hiệu suất trên mỗi watt. Thay vì tìm kiếm một "kiến trúc duy nhất", nghiên cứu đề xuất một chiến lược phân tầng (tiered architecture) dựa trên một quy trình phát hiện khả năng (capability detection) và benchmark vi mô tại thời điểm chạy (runtime micro-benchmarking).

Lịch trình hành động chính cho kiến trúc đề xuất được xây dựng trên ba trụ cột công nghệ chính: Rust biên dịch thành WebAssembly (WASM) cho các tác vụ CPU-bound, WebGPU để tận dụng sức mạnh song song của Apple GPU qua Metal, và WebCodecs để tiếp cận trực tiếp các encoder/decoder phần cứng của hệ thống [[41](https://webrtchacks.com/video-frame-processing-on-the-web-webassembly-webgpu-webgl-webcodecs-webnn-and-webtransport/), [98](https://dev.to/sylwia-lask/why-are-we-still-doing-gpu-work-in-javascript-live-webgpu-benchmark-demo-4j6i)]. Sự kết hợp này tạo ra một hệ sinh thái linh hoạt, cho phép các tác vụ được phân bổ một cách thông minh. Các tác vụ phù hợp với xử lý song song khối lượng lớn như tiền xử lý ảnh (resize, filter), sẽ được gửi đến WebGPU. Ngược lại, các tác vụ có logic tuần tự phức tạp như mã hóa WebP lossless sẽ được xử lý bởi Rust/WASM trên CPU [[232](https://medium.com/@ThinkingLoop/wasm-simd-for-on-device-ai-private-fast-offline-3ef82c47172d)]. Cuối cùng, các codec video phức tạp và yêu cầu hiệu quả năng lượng cao sẽ được ủy thác cho WebCodecs, vốn có khả năng tận dụng VideoToolbox framework của Apple [[68](https://developer.apple.com/documentation/videotoolbox), [96](https://www.freecodecamp.org/news/the-webcodecs-handbook-native-video-processing-in-the-browser/)].

Quy trình hoạt động của kiến trúc đề xuất bắt đầu bằng giai đoạn khởi tạo, nơi engine sẽ thực hiện một loạt các kiểm tra để xây dựng một bản đồ khả năng của môi trường trình duyệt. Giai đoạn này bao gồm việc xác định sự tồn tại của các API cốt lõi như `navigator.gpu` cho WebGPU, các lớp trừu tượng của WebCodecs như `VideoEncoder` và `AudioDecoder` [[115](https://www.testmuai.com/learning-hub/webcodecs-browser-support/)], và các tính năng nâng cao hơn như WASM SIMD (`WebAssembly.validate`) và WASM Threads thông qua `SharedArrayBuffer` [[19](https://www.testmuai.com/learning-hub/wasm-threads-browser-support/), [22](https://www.testmuai.com/learning-hub/webassembly-compatible-browsers/)]. Đặc biệt quan trọng là việc kiểm tra hỗ trợ codec cụ thể bằng cách sử dụng các hàm như `VideoEncoder.isConfigSupported()` hoặc `ImageDecoder.canDecode()`, thay vì phụ thuộc vào các cấu hình cứng dựa trên `userAgent` [[115](https://www.testmuai.com/learning-hub/webcodecs-browser-support/), [116](https://wpt.fyi/results/media-capabilities/decodingInfo.any.html?run_ids=4908746366255104,6286248175206400,4821710867267584)]. Việc kiểm tra này đảm bảo rằng engine chỉ chọn các đường dẫn mà thiết bị thực sự có khả năng xử lý.

Sau khi hoàn thành bước phát hiện khả năng, giai đoạn tiếp theo là benchmark vi mô. Đây là bước quyết định để lựa chọn backend hiệu quả nhất. Thay vì giả định rằng WebGPU luôn nhanh hơn WASM, benchmark nhỏ sẽ đo lường hiệu suất tương đối của các lựa chọn khả thi cho các tác vụ cụ thể. Ví dụ, một benchmark có thể đo thời gian cần thiết để xử lý một khung hình mẫu bằng một shader WebGPU đơn giản so với việc thực hiện cùng một tác vụ bằng một hàm Rust/WASM [[291](https://arxiv.org/abs/2604.02344), [295](https://arxiv.org/pdf/2608.08730)]. Kết quả của benchmark này rất quan trọng vì nó phản ánh thực tế hiệu suất trên driver, phiên bản hệ điều hành và chip cụ thể của thiết bị, vượt qua các suy luận mang tính định hướng của nhà phát triển. Dữ liệu này giúp engine đưa ra quyết định sáng suốt, ví dụ như nếu chi phí dispatch và truyền dữ liệu của WebGPU vượt quá lợi ích mà nó mang lại cho một tác vụ nhỏ, thì việc sử dụng WASM/SIMD có thể là lựa chọn hiệu quả hơn về năng lượng [[42](https://www.metavert.io/compare/webgpu-vs-wasm)].

Dựa trên kết quả từ hai giai đoạn trên, engine sẽ chọn một trong các pipeline sau đây, được sắp xếp theo thứ tự ưu tiên:

1.  **Pipeline Ưu tiên Cao nhất (High-End iPhone/iPad):** Đây là đường dẫn tối ưu nhất, dành cho các thiết bị có đủ khả năng phần cứng và trình duyệt mới nhất. Luồng hoạt động là: `Input File -> Browser Decode -> WebGPU Preprocessing -> WebCodecs Hardware Encode -> Output`. Trong pipeline này, `Browser Decode` có thể là `ImageBitmap` cho ảnh hoặc `VideoFrame` cho video. Tiền xử lý (resize, filter, convert colorspace) được thực hiện hiệu quả trên GPU, sau đó kết quả được chuyển đến `WebCodecs` để mã hóa bằng phần cứng, tối đa hóa hiệu suất và tiết kiệm năng lượng [[193](https://www.youtube.com/watch?v=bEP5VrMtGaE), [196](https://www.linkedin.com/pulse/part-2-webcodecs-webgpu-hardware-accelerated-video-processing-9xqef)].

2.  **Pipeline Thay thế Hybrid (Mid-Range/Unstable GPU):** Khi WebGPU không ổn định hoặc benchmark cho thấy chi phí truyền dữ liệu từ GPU về CPU cho tác vụ mã hóa quá cao, pipeline này trở thành lựa chọn thay thế. Luồng hoạt động là: `Input File -> WebGPU Preprocessing -> Copy to CPU -> Rust/WASM SIMD Encoder -> Output`. Ở đây, tiền xử lý vẫn được hưởng lợi từ GPU, nhưng codec phức tạp hơn (như AV1) sẽ được xử lý trên CPU/WASM. Cách tiếp cận này cung cấp một sự cân bằng tốt giữa hiệu suất và khả năng tương thích.

3.  **Pipeline Fallback Hybrid (WebGPU Unavailable):** Trường hợp này xảy ra khi WebGPU không được hỗ trợ hoặc bị lỗi. Đường dẫn thay thế sẽ là: `Input File -> Rust/WASM SIMD Preprocessing -> WebCodecs Hardware Encode -> Output`. Toàn bộ quá trình tiền xử lý và mã hóa sẽ được thực hiện trên CPU, nhưng engine vẫn cố gắng tận dụng phần cứng codec của hệ thống thông qua WebCodecs để đảm bảo hiệu quả năng lượng ở mức tối đa có thể.

4.  **Pipeline Fallback Cuối cùng (CPU-bound):** Đây là phương án dự phòng khi cả WebGPU và WebCodecs đều không khả dụng. Toàn bộ quá trình, từ tiền xử lý đến mã hóa, sẽ được thực hiện bởi các thư viện được biên dịch từ Rust sang WASM. Một lựa chọn mạnh mẽ trong trường hợp này là sử dụng FFmpeg.wasm, vốn có khả năng xử lý hầu hết mọi định dạng và codec [[247](https://github.com/ffmpegwasm/ffmpeg.wasm/issues/299)]. Mặc dù đây là giải pháp an toàn, nó có thể gây tốn kém về năng lượng và có nguy cơ bị giới hạn bởi dung lượng RAM trên thiết bị di động [[139](https://www.reddit.com/r/applesucks/comments/1kfp98k/with_ios_184_apple_crossed_a_line/)].

Chiến lược này không chỉ là một lý thuyết, mà là một lộ trình hành động cụ thể. Nó thừa nhận sự đa dạng của hệ sinh thái iOS, nơi các thiết bị từ dòng A-series cũ đến các con chip Pro và M-series mới nhất đều có mặt [[183](https://www.reddit.com/r/apple/comments/1o6rgk6/apple_silicon_speed_test_every_iphone_ipad_and/)]. Bằng cách xây dựng một hệ thống có khả năng tự điều chỉnh, developer có thể đảm bảo trải nghiệm người dùng tốt nhất có thể trên mọi thiết bị, đồng thời tuân thủ nghiêm ngặt các nguyên tắc về hiệu suất và hiệu quả năng lượng. Việc áp dụng Web Workers là một phần không thể thiếu của kiến trúc này, giúp tách biệt các tác vụ tính toán nặng ra khỏi luồng giao diện người dùng chính, đảm bảo ứng dụng luôn mượt mà và phản hồi nhanh chóng [[158](https://dev.to/pockit_tools/why-your-react-app-feels-slow-fixing-performance-with-web-workers-439h), [160](https://www.linkedin.com/pulse/improve-reactjs-performance-web-workers-solving-single-vaibhav-gehani-u0bsf)]. Mỗi luồng xử lý sẽ chạy trong một `DedicatedWorker`, giao tiếp với luồng chính thông qua các message-passing với `Transferable Objects` để giảm thiểu chi phí sao chép bộ nhớ [[154](https://www.reddit.com/r/javascript/comments/1h3m2rv/askjs_reducing_web_worker_communication_overhead/)].

## Phân Tích Sâu Công nghệ Core: Rust/WASM, WebGPU, WebCodecs

Sự thành công của kiến trúc xử lý phương tiện phía client phụ thuộc vào việc hiểu và tận dụng đúng đắn từng lớp công nghệ core: Rust biên dịch sang WebAssembly cho các tác vụ trên CPU, WebGPU cho GPU, và WebCodecs cho phần cứng. Mỗi lớp có những ưu điểm, hạn chế và kịch bản sử dụng riêng biệt, và việc phân chia công việc một cách hợp lý giữa chúng là chìa khóa để tối ưu hóa hiệu suất trên mỗi watt.

**Rust → WebAssembly trên iOS: Tầng Logic Tuần tự và Tối ưu CPU**

Rust được lựa chọn làm ngôn ngữ lập trình chính nhờ vào khả năng cung cấp hiệu suất gần với native, tính an toàn về bộ nhớ mà không cần garbage collection, và khả năng biên dịch sang WebAssembly (WASM) [[54](https://developer.mozilla.org/en-US/docs/WebAssembly), [138](https://terraphim.ai/capabilities/rust-wasm/)]. Trên hệ sinh thái Apple, quá trình này được hỗ trợ bởi một công cụ chuỗi vững chắc. Dự án Rust sẽ được đóng gói bằng `wasm-pack`, một công cụ giúp xây dựng, kiểm thử và đăng tải các gói Rust/WASM lên npm [[244](https://github.com/rustwasm/awesome-rust-and-webassembly)]. `wasm-pack` tự động tạo ra các binding JavaScript thông qua `wasm-bindgen`, cho phép JavaScript tương tác dễ dàng với Rust [[44](https://www.youtube.com/watch?v=N25oMCsyaZ0)]. Để gọi các API web từ Rust, các crate như `web-sys` và `js-sys` cung cấp các binding đầy đủ cho hầu hết các API trình duyệt, cho phép Rust tương tác với DOM, WebGPU, WebCodecs, v.v. [[94](https://github.com/kixelated/web-rs)].

Tuy nhiên, việc triển khai Rust/WASM trên Safari/iOS có những giới hạn và thách thức riêng. Hỗ trợ WASM SIMD (Single Instruction, Multiple Data) là một yếu tố quan trọng để tăng tốc các vòng lặp xử lý ảnh/video. Safari đã bắt đầu hỗ trợ SIMD từ phiên bản 16.4 (tháng 3 năm 2023), và hiện nay khoảng 95% các phiên bản trình duyệt trên toàn cầu có thể chạy module WASM SIMD [[22](https://www.testmuai.com/learning-hub/webassembly-compatible-browsers/), [32](https://platform.uno/blog/safari-16-4-support-for-webassembly-fixed-width-simd-how-to-use-it-with-c/), [37](https://www.testmuai.com/learning-hub/wasm-simd-browser-support/)]. Điều này cực kỳ quan trọng vì các thuật toán xử lý pixel thường có thể được vector hóa để thực hiện các phép toán trên nhiều pixel cùng một lúc, mang lại tốc độ tăng đáng kể [[234](https://dev.to/bence_rcz_fe471c168707c1/rust-webassembly-performance-javascript-vs-wasm-bindgen-vs-raw-wasm-with-simd-4pco), [235](https://medium.com/@oemaxwell/rust-webassembly-performance-javascript-vs-wasm-bindgen-vs-raw-wasm-with-simd-687b1dc8127b)]. Đối với các tác vụ yêu cầu xử lý song song, WASM Threads là giải pháp. Tuy nhiên, nó phụ thuộc vào `SharedArrayBuffer`, một tính năng mà Apple đã hạn chế nghiêm ngặt do các lỗ hổng bảo mật Spectre [[125](https://www.reddit.com/r/WebAssembly/comments/rk83mr/wasm_threads_are_now_available_in_all_browsers/), [155](https://qouteall.fun/qouteall-blog/2025/WebAsembly%20Limitations)]. Mặc dù Safari hỗ trợ WASM threads từ phiên bản 14.5+, việc sử dụng chúng trên iOS có thể gặp rắc rối và không phải lúc nào cũng khả thi [[19](https://www.testmuai.com/learning-hub/wasm-threads-browser-support/), [119](https://forum.babylonjs.com/t/what-are-the-most-cpu-intensive-tasks-worker-threads-wasm-discussion/23329)]. Do đó, việc triển khai đa luồng cần được kiểm tra cẩn thận và có cơ chế fallback sang single-thread WASM. Các crate như `rayon` có thể được sử dụng để song song hóa các tác vụ trên CPU, nhưng nó cũng phụ thuộc vào WASM threads [[301](https://dev.to/toshiya_matsumoto_ac94abe/run-multi-threads-with-rust-on-browser-rayon-and-2-layers-web-worker-mechanism-10ne)].

Nói tóm lại, Rust/WASM là nền tảng vững chắc cho các tác vụ không thể song song hóa, đặc biệt là các thuật toán mã hóa không mất mát như WebP, nơi logic tuần tự chiếm ưu thế [[232](https://medium.com/@ThinkingLoop/wasm-simd-for-on-device-ai-private-fast-offline-3ef82c47172d)]. Bằng cách tối ưu hóa cấu hình build trong `Cargo.toml` (sử dụng `opt-level = "z"` cho kích thước nhỏ, LTO, và `panic = "abort"`) [[105](https://repositorio.inesctec.pt/server/api/core/bitstreams/0870fb76-d463-456b-9e34-5b33bb7c0dd1/content), [300](https://medium.com/@yujiisobe/i-was-understanding-wasm-all-wrong-e4bcab8d077c)], có thể tạo ra các module WASM vừa nhỏ gọn vừa nhanh.

**WebGPU trên iOS: Động cơ Metal Thực sự**

WebGPU đại diện cho một bước tiến lớn trong khả năng xử lý đồ họa và tính toán song song trên web. Trên iOS/iPadOS, WebGPU không phải là một abstract layer mới; nó là một wrapper trực tiếp cho Metal, framework đồ họa cấp thấp của Apple [[12](https://developer.apple.com/videos/play/wwdc2025/236/), [107](https://dev.to/arshtechpro/wwdc-2025-webgpu-on-apple-platforms-16pa)]. Điều này loại bỏ lớp translation từ OpenGL legacy như WebGL, mang lại hiệu suất và hiệu quả năng lượng cao hơn đáng kể [[237](https://webkit.org/blog/17640/webkit-features-for-safari-26-2/)]. WebGPU đã được kích hoạt mặc định trên Safari 26 beta trở lên, đánh dấu một cột mốc quan trọng cho các ứng dụng web đòi hỏi hiệu năng cao trên thiết bị Apple [[51](https://webkit.org/blog/16993/news-from-wwdc25-web-technology-coming-this-fall-in-safari-26-beta/), [112](https://github.com/bevyengine/bevy-website/issues/2151), [150](https://www.webgpu.com/news/webgpu-hits-critical-mass-all-major-browsers/)].

Một kiến trúc WebGPU điển hình trên iOS hoạt động như sau:
```text
JavaScript
   ↓ (API calls)
WebKit
   ↓ (Maps directly to)
Metal Framework
   ↓ (Commands sent to)
Apple GPU (e.g., A-series, M-series GPU)
```
Quá trình này cho phép JavaScript gửi các lệnh đến GPU thông qua WebKit, và WebKit chuyển đổi chúng thành các lệnh Metal, sau đó GPU thực thi [[12](https://developer.apple.com/videos/play/wwdc2025/236/)].

Để tối ưu hóa, cần hiểu rõ các thao tác trong WebGPU:
*   **Command Encoder & Queue Submission:** Các lệnh (copy, compute, render) được ghi vào một `command encoder`, sau đó được "bản nháp" (finished) để tạo thành một `command buffer`. `command buffer` này được thêm vào một `queue` để GPU thực thi. Chi phí của việc submit một dispatch (gọi hàm compute shader) là đáng kể, chiếm khoảng 40% thời gian CPU và kéo dài khoảng 12.9 µs trên các thiết bị hiện đại [[295](https://arxiv.org/pdf/2608.08730)].
*   **Buffers & Textures:** Dữ liệu đầu vào (ảnh, video frame) thường được lưu trữ trong `GPUBuffer` hoặc `GPUTexture`. `GPUBuffer` dùng cho dữ liệu tuyến tính (ví dụ: pixel array), trong khi `GPUTexture` dùng cho dữ liệu 2D/3D (ảnh, video). Sử dụng `texture storage` (tài nguyên texture có thể đọc/ghi từ compute shader) là một tính năng quan trọng cho các thuật toán xử lý ảnh phức tạp [[12](https://developer.apple.com/videos/play/wwdc2025/236/)].
*   **Memory Transfer & Overhead:** Một trong những thách thức lớn nhất là chi phí chuyển dữ liệu giữa CPU và GPU. Dữ liệu từ `ArrayBuffer` JavaScript phải được copy qua một `staging buffer` rồi mới copy sang `GPUBuffer` hoặc `GPUTexture` [[290](https://webgpufundamentals.org/webgpu/lessons/webgpu-optimization.html)]. Trên các hệ thống tách rời, chi phí này rất cao. Tuy nhiên, trên Apple Silicon với Unified Memory Architecture (UMA), CPU và GPU chia sẻ cùng một không gian địa chỉ vật lý, giúp giảm đáng kể chi phí copy này [[106](https://www.reddit.com/r/LocalLLM/comments/1mw7vy8/can_someone_explain_technically_why_apple_shared/), [144](https://arxiv.org/pdf/2501.14925)]. Điều này làm cho pipeline hybrid (WebGPU + WASM) trở nên hấp dẫn hơn trên các thiết bị Apple mới.

Các tác vụ phù hợp để đưa lên WebGPU bao gồm: resize, crop, convolutions (blur, sharpen), color space conversion (RGB ↔ YUV), histogram, và các bộ lọc ảnh khác [[99](https://joanleon.dev/en/webgpu-browser-performance/), [100](https://bhavyansh001.medium.com/forget-webassembly-webgpu-is-the-real-revolution-developers-should-watch-4539ff7c57a5)]. Ngược lại, các tác vụ có logic tuần tự phức tạp, chi phí dispatch cao cho đầu vào nhỏ, hoặc yêu cầu truyền dữ liệu liên tục giữa CPU và GPU sẽ không hiệu quả khi chạy trên GPU [[291](https://arxiv.org/abs/2604.02344)].

**WebCodecs: Cửa ngõ tới Phần cứng Apple**

WebCodecs là một API quan trọng khác, được thiết kế để cho phép giải mã và mã hóa video/audio ở cấp độ thấp, tận dụng phần cứng của hệ thống [[96](https://www.freecodecamp.org/news/the-webcodecs-handbook-native-video-processing-in-the-browser/)]. Trên iOS, WebCodecs tương tác trực tiếp với VideoToolbox framework, cung cấp các encoder/decoder hiệu quả về năng lượng và hiệu suất cao [[68](https://developer.apple.com/documentation/videotoolbox)]. API này bao gồm các lớp trừu tượng như `VideoDecoder`, `VideoEncoder`, `ImageDecoder`, `EncodedVideoChunk`, và `VideoFrame` [[269](https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API), [271](https://developer.chrome.com/docs/web-platform/best-practices/webcodecs)].

Hỗ trợ WebCodecs đã có mặt trên Safari từ phiên bản 26+ [[115](https://www.testmuai.com/learning-hub/webcodecs-browser-support/)]. Điều này mở ra khả năng xử lý video hardware-accelerated. Tuy nhiên, hỗ trợ cho các codec cụ thể phụ thuộc vào phần cứng. Ví dụ, hỗ trợ AV1 decode trên Safari chỉ có sẵn trên các thiết bị có chip M3 MacBooks và máy tính bảng iPad Pro A16 Pro trở lên [[23](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Formats/Video_codecs), [227](https://webkit.org/blog/18128/release-notes-for-safari-technology-preview-246/)]. Do đó, việc kiểm tra `VideoEncoder.isConfigSupported()` hoặc `MediaCapabilities.decodingInfo()` là bắt buộc để xác định codec nào có thể được sử dụng trên thiết bị đích [[222](https://webkit.org/blog/17896/release-notes-for-safari-technology-preview-240/)].

Một điểm yếu hiện tại của WebCodecs là sự thiếu kết nối liền mạch với WebGPU. Hiện tại, không có API chuẩn nào cho phép chuyển trực tiếp một `VideoFrame` vào một WebGPU compute shader. Cách tiếp cận phổ biến nhất là chuyển đổi `VideoFrame` sang `ImageBitmap` (qua `VideoFrame.toImageBitmap()`) và sau đó vẽ `ImageBitmap` lên một `OffscreenCanvas` để lấy `GPUTexture`. Quá trình này có thể tạo ra một hoặc hai lần copy, làm tăng chi phí truyền dữ liệu [[41](https://webrtchacks.com/video-frame-processing-on-the-web-webassembly-webgpu-webgl-webcodecs-webnn-and-webtransport/)]. Đây là một rào cản lớn đối với việc xây dựng các pipeline hiệu quả về năng lượng và là một khu vực cần theo dõi sát sao để các cải tiến trong tương lai.

Tóm lại, WebCodecs nên được ưu tiên hàng đầu cho các tác vụ mã hóa và giải mã video, đặc biệt là các codec phổ biến như H.264 và các codec mở như VP9 và AV1, miễn là chúng được hỗ trợ bởi thiết bị. Nó là giải pháp tối ưu cho các tác vụ yêu cầu hiệu quả năng lượng cao và không cần can thiệp phức tạp từ phía người dùng.

## Pipeline Xử lý Hình ảnh: Từ HEIC đến WebP Lossless

Xây dựng một pipeline xử lý hình ảnh hiệu quả trên iOS không chỉ là về tốc độ, mà còn là về việc tối thiểu hóa việc sao chép bộ nhớ và tận dụng tối đa các tầng công nghệ có sẵn, từ trình duyệt đến phần cứng. Mục tiêu cụ thể ở đây là chuyển đổi một tệp hình ảnh đầu vào (ví dụ từ `<input type="file">`) thành một hình ảnh WebP không mất mát, trong khi duy trì hiệu suất cao và tiết kiệm năng lượng.

**Bước 1: Nhập và Giải Mã Đầu vào (Input & Decode)**

Luồng bắt đầu khi người dùng chọn một tệp hình ảnh. Dữ liệu đầu vào dưới dạng `Blob`. Để tránh việc tải toàn bộ tệp vào bộ nhớ RAM, đặc biệt quan trọng trên thiết bị di động có dung lượng hạn chế, nên sử dụng các API stream. Tuy nhiên, đối với việc giải mã, một cách tiếp cận hiệu quả hơn là để trình duyệt xử lý việc này. Với các định dạng phổ biến như JPEG, PNG, và cả HEIC trên iOS, Safari có khả năng giải mã nội bộ. Đối với HEIC, định dạng hình ảnh mặc định trên iPhone, Safari/iOS có thể sử dụng VideoToolbox để giải mã nó thành một `VideoFrame` hoặc `ImageBitmap` [[73](https://dev.to/video/working-with-videotoolbox-for-more-control-over-video-encoding-and-decoding-6n1)]. Cách tiếp cận tốt nhất là sử dụng `createImageBitmap(fileObject)` hoặc `new ImageDecoder({type: 'image/heic'})` nếu trình duyệt hỗ trợ. Điều này cho phép trình duyệt giải mã hình ảnh và trả về một đối tượng `ImageBitmap` hoặc `VideoFrame` mà không cần phải tải toàn bộ dữ liệu pixel vào một `ArrayBuffer` JavaScript, giúp giảm thiểu việc sao chép và sử dụng bộ nhớ.

**Bước 2: Tiền Xử lý trên GPU (Preprocessing on GPU)**

Sau khi có `ImageBitmap` hoặc `VideoFrame`, bước tiếp theo là tiền xử lý, chẳng hạn như thay đổi kích thước, cắt, hoặc chuyển đổi không gian màu. Đây là những tác vụ hoàn hảo cho WebGPU. Một kernel WGSL đơn giản có thể thực hiện các phép toán trên từng pixel một cách song song.
*   **Resize:** Các thuật toán như bilinear hoặc bicubic có thể được triển khai hiệu quả trên GPU.
*   **Colorspace Conversion:** Chuyển đổi giữa sRGB, BT.709, YUV, v.v., là các phép toán tuyến tính trên từng pixel, rất phù hợp với WebGPU [[99](https://joanleon.dev/en/webgpu-browser-performance/)].
*   **Filters:** Blur, Sharpen, Denoise cũng là các convolution kernels, có thể được thực hiện nhanh chóng trên GPU [[100](https://bhavyansh001.medium.com/forget-webassembly-webgpu-is-the-real-revolution-developers-should-watch-4539ff7c57a5)].

Tuy nhiên, một câu hỏi then chốt là: Có nên đưa các tác vụ tiền xử lý này lên GPU? Trong hầu hết các trường hợp, câu trả lời là có. Tuy nhiên, cần phải cân nhắc kỹ lưỡng chi phí chuyển dữ liệu. Việc chuyển một `ImageBitmap` hoặc `VideoFrame` thành một `GPUTexture` có thể đòi hỏi một lần copy từ bộ nhớ của trình duyệt sang bộ nhớ VRAM của GPU [[290](https://webgpufundamentals.org/webgpu/lessons/webgpu-optimization.html)]. Trên các thiết bị Apple Silicon với Unified Memory Architecture (UMA), chi phí này được giảm nhẹ đáng kể vì CPU và GPU chia sẻ cùng một không gian địa chỉ, cho phép truy cập nhanh hơn [[106](https://www.reddit.com/r/LocalLLM/comments/1mw7vy8/can_someone_explain_technically_why_apple_shared/), [144](https://arxiv.org/pdf/2501.14925)]. Một benchmark vi mô là cần thiết để xác định xem lợi ích từ việc xử lý song song trên GPU có vượt trội hơn chi phí ban đầu không.

**Bước 3: Mã hóa Lossless (Lossless Encoding)**

Đây là phần thách thức nhất và là nơi kiến trúc phải đưa ra quyết định khó khăn. Câu hỏi đặt ra là: Liệu có nên đưa encoder WebP lossless lên GPU không?

Phân tích về thuật toán WebP lossless cho thấy rằng nó không phù hợp để chạy trên WebGPU. Các bước chính trong encoder WebP lossless bao gồm:
1.  **Predictors:** Các thuật toán dự đoán (subtract-green, etc.) là các phép toán trên từng pixel, tuy nhiên chúng là các chuỗi logic tuần tự và phụ thuộc lẫn nhau, không dễ để song song hóa.
2.  **Transforms:** Các phép biến đổi như Color Cache và Entropy Coding là các thuật toán mã hóa không mất mát, vốn dĩ là các bài toán tuần tự, không phải song song.
3.  **Entropy Coding:** Sử dụng Huffman coding hoặc arithmetic coding, đây là những thuật toán mã hóa phức tạp, đòi hỏi xử lý tuần tự và không có tính song song hóa tự nhiên.

Do đó, encoder WebP lossless phải là một tác vụ chạy trên WASM/CPU. May mắn thay, có nhiều thư viện Rust đã được tối ưu hóa cho mục đích này. Các crate như `image` [[231](https://www.reddit.com/r/rust/comments/1cj94va/image_v025_performance_improvements/)] và `webp` [[88](https://news.ycombinator.com/item?id=41973116)] là những lựa chọn hàng đầu. Chúng có thể được biên dịch thành WASM và tương tác với JavaScript qua `wasm-bindgen`.

Để tối ưu hóa quá trình này, cần áp dụng các kỹ thuật sau:
*   **Tối ưu hóa Build:** Sử dụng `wasm-pack` với cấu hình `Cargo.toml` tối ưu: `opt-level = "z"` để giảm kích thước, `lto = true` để tối ưu hóa liên crate, và `panic = "abort"` để loại bỏ mã dư thừa của Rust [[105](https://repositorio.inesctec.pt/server/api/core/bitstreams/0870fb76-d463-456b-9e34-5b33bb7c0dd1/content), [300](https://medium.com/@yujiisobe/i-was-understanding-wasm-all-wrong-e4bcab8d077c)].
*   **WASM SIMD:** Các vòng lặp xử lý pixel trong encoder có thể được đẩy nhanh đáng kể bằng cách sử dụng WASM SIMD. Các benchmark cho thấy SIMD có thể làm tăng tốc độ xử lý mảng lên ~6x so với JavaScript thuần và ~1.7x so với WASM không có SIMD [[234](https://dev.to/bence_rcz_fe471c168707c1/rust-webassembly-performance-javascript-vs-wasm-bindgen-vs-raw-wasm-with-simd-4pco), [235](https://medium.com/@oemaxwell/rust-webassembly-performance-javascript-vs-wasm-bindgen-vs-raw-wasm-with-simd-687b1dc8127b)]. Trên Apple CPU với NEON instruction set, Rust's portable `std::simd` có thể được biên dịch hiệu quả thành mã máy ARM, mang lại tốc độ cao [[163](https://www.reddit.com/r/rust/comments/1qsx4we/rust_simd_benchmark_stdsimd_vs_neon_on_apple_m4/)].
*   **Multithreading:** Nếu WASM Threads được hỗ trợ và cấu hình COOP/COEP cho phép, các tác vụ lớn có thể được chia nhỏ và xử lý trên nhiều luồng để tận dụng các core hiệu năng và cảm xúc của Apple CPU [[301](https://dev.to/toshiya_matsumoto_ac94abe/run-multi-threads-with-rust-on-browser-rayon-and-2-layers-web-worker-mechanism-10ne)].

**Bước 4: Sao chép từ GPU về CPU và Xuất**

Cuối cùng, sau khi tiền xử lý hoàn tất trên GPU và tạo ra một `GPUTexture`, để mã hóa bằng WASM, ta cần chuyển dữ liệu này về bộ nhớ CPU. Quá trình này bắt buộc phải có một lần copy từ VRAM của GPU về một `ArrayBuffer` JavaScript. Cách thực hiện hiệu quả nhất là sử dụng `copyTextureToBuffer` của WebGPU, sau đó chờ `GPUQueue.onSubmittedDone` để đảm bảo rằng quá trình copy đã hoàn tất trước khi gửi `ArrayBuffer` cho WASM [[290](https://webgpufundamentals.org/webgpu/lessons/webgpu-optimization.html)]. Mặc dù có một lần copy, đây là bước bắt buộc và cần được thực hiện một cách hiệu quả nhất có thể để không làm chậm toàn bộ pipeline.

Tóm lại, pipeline xử lý hình ảnh đề xuất là một sự kết hợp của các tầng công nghệ:
1.  **Nhập/Décod:** Sử dụng `createImageBitmap` hoặc `ImageDecoder` để giải mã đầu vào một cách hiệu quả.
2.  **Tiền xử lý:** Thực hiện các tác vụ song song hóa khối lượng lớn (resize, filter) trên WebGPU.
3.  **Sao chép (nếu cần):** Dùng `copyTextureToBuffer` để chuyển kết quả từ GPU về CPU.
4.  **Mã hóa:** Gửi `ArrayBuffer` đến một module Rust/WASM để thực hiện mã hóa WebP lossless.
5.  **Xuất:** Nhận `Uint8Array` kết quả và tạo thành một tệp `Blob` mới.

Kiến trúc này tận dụng được thế mạnh của từng công nghệ, giảm thiểu việc sao chép dữ liệu không cần thiết, và đảm bảo tính toàn vẹn dữ liệu trong chế độ không mất mát.

## Pipeline Xử lý Video: Tận Dụng WebCodecs và phần cứng Acceleration

Xử lý video phía client trên trình duyệt di động là một lĩnh vực đầy thách thức, nơi sự khác biệt về hiệu suất, khả năng phần cứng và các giới hạn của trình duyệt trở nên rõ ràng nhất. Mục tiêu là xây dựng một pipeline linh hoạt có thể xử lý video đầu vào, tiền xử lý (nếu cần) và mã hóa thành một định dạng đầu ra (ví dụ: WebM với codec VP9 hoặc AV1), trong khi tối ưu hóa cho hiệu suất trên mỗi watt trên các thiết bị iOS/iPadOS.

**Bước 1: Giải mã và Nhận Khung hình (Demux & Decode Frames)**

Thay vì tải toàn bộ tệp video vào bộ nhớ RAM—một hành động có thể gây quá tải tài nguyên trên thiết bị di động—cách tiếp cận tiên tiến nhất là sử dụng Streams API. Bằng cách sử dụng `MediaSource` và `ReadableStream`, video có thể được xử lý dưới dạng các khối nhỏ liên tục, cho phép pipeline hoạt động theo kiểu streaming [[46](https://www.w3.org/2023/09/TPAC/demos/video-processing.html), [193](https://www.youtube.com/watch?v=bEP5VrMtGaE)]. Các `EncodedVideoChunk` sau đó được gửi đến một `VideoDecoder` được cấu hình với các thông số phù hợp (codec, width, height). `VideoDecoder` sẽ giải mã các chunk này và tạo ra các `VideoFrame` [[271](https://developer.chrome.com/docs/web-platform/best-practices/webcodecs)]. Quá trình này, được gọi là demuxing và decoding, có thể được thực hiện hiệu quả về năng lượng nhờ sự hỗ trợ của phần cứng (VideoToolbox) [[96](https://www.freecodecamp.org/news/the-webcodecs-handbook-native-video-processing-in-the-browser/)].

**Bước 2: Tiền Xử lý trên GPU (Preprocessing on GPU)**

Sau khi có `VideoFrame`, ta có thể thực hiện các thao tác tiền xử lý như thay đổi kích thước, áp bộ lọc, hoặc chuyển đổi không gian màu. Tương tự như xử lý ảnh, đây là những tác vụ song song hóa hoàn hảo và nên được thực hiện trên WebGPU. Một `VideoFrame` có thể được chuyển đổi thành một `ImageBitmap` (bằng `VideoFrame.toImageBitmap()`) và sau đó vẽ lên một `OffscreenCanvas` để lấy một `GPUTexture` [[41](https://webrtchacks.com/video-frame-processing-on-the-web-webassembly-webgpu-webgl-webcodecs-webnn-and-webtransport/)]. Sau đó, một compute shader WebGPU có thể thao tác lên `GPUTexture` này. Quá trình này giúp giảm tải cho CPU, vốn có thể bị quá tải bởi các tác vụ xử lý video. Tuy nhiên, như đã đề cập, việc chuyển đổi này có thể tạo ra các chi phí sao chép tiềm ẩn, và đây là một điểm cần benchmark kỹ lưỡng trên các thiết bị Apple.

**Bước 3: Mã hóa và Xuất (Encode and Output)**

Sau khi tiền xử lý, `VideoFrame` được gửi đến `VideoEncoder` để mã hóa. Đây là nơi WebCodecs tỏa sáng.
*   **Ưu tiên hàng đầu là WebCodecs:** `VideoEncoder` có khả năng sử dụng hardware encoder của hệ thống (VideoToolbox) để mã hóa `VideoFrame` thành các `EncodedVideoChunk` đầu ra [[68](https://developer.apple.com/documentation/videotoolbox)]. Điều này mang lại hiệu suất và hiệu quả năng lượng cao nhất có thể. Các định dạng phổ biến như WebM với codec VP9 và AV1 là các lựa chọn tốt.
*   **Hỗ trợ Codec trên iOS:** Hỗ trợ codec trên Safari/iOS có thể thay đổi tùy thuộc vào phiên bản trình duyệt và chip phần cứng.
    *   **VP9:** Được hỗ trợ rộng rãi trên Safari 17+ [[29](https://news.ycombinator.com/item?id=33310631), [85](https://wpt.fyi/results/media-capabilities/decodingInfo-webrtc.any.worker.html?run_ids=4908746366255104,6286248175206400,4821710867267584)].
    *   **AV1:** Hỗ trợ decode trên Safari đã có từ lâu, nhưng hỗ trợ encode phụ thuộc vào phần cứng. Chỉ các thiết bị mới hơn như M3 MacBooks và iPad Pro A16 Pro trở lên mới có decoder AV1 phần cứng, và thậm chí còn có thêm hỗ trợ encode trong các phiên bản Safari mới hơn [[23](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Formats/Video_codecs), [113](https://webcodecsfundamentals.org/datasets/codec-analysis-2026/), [227](https://webkit.org/blog/18128/release-notes-for-safari-technology-preview-246/)]. Cần kiểm tra `VideoEncoder.isConfigSupported()` để xác nhận khả năng này [[115](https://www.testmuai.com/learning-hub/webcodecs-browser-support/)].
*   **Fallback khi WebCodecs không khả dụng:** Nếu WebCodecs không được hỗ trợ hoặc codec mong muốn không có trong danh sách, giải pháp thay thế mạnh mẽ nhất là sử dụng FFmpeg.wasm [[247](https://github.com/ffmpegwasm/ffmpeg.wasm/issues/299)]. FFmpeg.wasm là một bản port của FFmpeg, một thư viện mã nguồn mở khổng lồ, có thể xử lý gần như mọi định dạng và codec. Tuy nhiên, nó chạy hoàn toàn trên CPU (WASM), có thể gây tốn kém về năng lượng và nóng máy trên các thiết bị cũ hơn. Ngoài ra, nó cũng dễ gặp lỗi Out-of-Memory (OOM) trên các thiết bị có RAM hạn chế [[247](https://github.com/ffmpegwasm/ffmpeg.wasm/issues/299)].
*   **Fallback khác:** Nếu FFmpeg quá nặng, có thể cân nhắc các codec WASM khác được tối ưu hóa cho web, nhưng chúng thường không có khả năng phần cứng acceleration và có thể không hỗ trợ tất cả các codec.

**Đề xuất Pipeline Phân Lớp cho Video**

Dựa trên phân tích trên, có thể đề xuất các pipeline sau:

*   **Pipeline 1 - High-end iPhone/iPad (WebGPU + WebCodecs):**
    ```text
    Input File
        ↓ (MediaSource Stream)
    EncodedVideoChunk
        ↓ (VideoDecoder)
    VideoFrame
        ↓ (WebGPU Preprocessing via OffscreenCanvas)
    Processed VideoFrame
        ↓ (VideoEncoder)
    EncodedVideoChunk
        ↓ (MediaEncoder/MediaStream)
    Output (e.g., WebM)
    ```
    Đây là pipeline tối ưu nhất, tận dụng tối đa cả GPU và phần cứng codec.

*   **Pipeline 2 - Mid-range iPhone/iPad (WebGPU + WASM Fallback):**
    ```text
    Input File
        ↓ (MediaSource Stream)
    EncodedVideoChunk
        ↓ (VideoDecoder)
    VideoFrame
        ↓ (WebGPU Preprocessing)
    Processed VideoFrame
        ↓ (Convert to ImageBitmap/ArrayBuffer)
    ArrayBuffer
        ↓ (WASM SIMD/Threads Encoder)
    Output (e.g., VP9/AV1 in WebM)
    ```
    Nếu `VideoEncoder` không hỗ trợ codec mong muốn, pipeline này sẽ chuyển sang dùng một encoder WASM.

*   **Pipeline 3 - Fallback Hybrid (WebGL/OffscreenCanvas + WASM):**
    ```text
    Input File
        ↓ (MediaSource Stream)
    EncodedVideoChunk
        ↓ (VideoDecoder)
    VideoFrame
        ↓ (OffscreenCanvas Drawing API)
    Canvas Image Data
        ↓ (WASM SIMD/Threads Preprocessing)
    Processed Image Data
        ↓ (WASM SIMD/Threads Encoder)
    Output (e.g., VP9/AV1 in WebM)
    ```
    Khi WebGPU không khả dụng, tiền xử lý có thể được thực hiện bằng các phép vẽ trên `OffscreenCanvas` và sau đó chuyển sang WASM.

*   **Pipeline 4 - Fallback Cuối cùng (CPU-only with FFmpeg.wasm):**
    ```text
    Input File
        ↓ (MediaSource Stream)
    EncodedVideoChunk
        ↓ (FFmpeg.wasm Demuxer/Decoder)
    Raw Video Frames (as ArrayBuffer)
        ↓ (FFmpeg.wasm Filter/Scale)
    Processed Raw Frames
        ↓ (FFmpeg.wasm Encoder)
    Output (e.g., VP9/AV1 in WebM)
    ```
    Đây là giải pháp an toàn, nhưng tốn kém về năng lượng và tài nguyên, nên chỉ nên dùng khi mọi phương án khác đều thất bại.

Cuối cùng, việc quản lý bộ nhớ là cực kỳ quan trọng. Luôn ưu tiên sử dụng `Transferable Objects` khi chuyển `ArrayBuffer` giữa các `Worker` và sử dụng `close()` trên các `VideoFrame` và `EncodedVideoChunk` khi không cần nữa để giải phóng tài nguyên sớm [[94](https://github.com/kixelated/web-rs), [154](https://www.reddit.com/r/javascript/comments/1h3m2rv/askjs_reducing_web_worker_communication_overhead/)]. Sự kết hợp của các pipeline này, cùng với cơ chế tự động chọn backend dựa trên benchmark, sẽ tạo ra một giải pháp xử lý video mạnh mẽ, linh hoạt và hiệu quả cho nền tảng iOS.

## Quản lý Bộ nhớ và Kiến trúc Không sao chép trên iOS

Trong các ứng dụng xử lý phương tiện, đặc biệt là trên thiết bị di động với dung lượng RAM hạn chế và các giới hạn về hiệu suất, việc quản lý bộ nhớ một cách hiệu quả không chỉ là một yếu tố tối ưu hóa, mà là một yêu cầu sống còn. Mục tiêu cuối cùng là giảm thiểu số lần sao chép bộ nhớ (memory copies) xuống mức thấp nhất có thể, hướng tới một kiến trúc gần như không cần sao chép. Tuy nhiên, để đạt được điều này, ta phải hiểu rõ các công cụ và giới hạn của từng tầng công nghệ trên iOS.

**Các Nguyên Tố Cơ Bản của Quản lý Bộ nhớ Web**

Hiểu biết về các đối tượng bộ nhớ cốt lõi là bước đầu tiên:
*   **ArrayBuffer & SharedArrayBuffer:** `ArrayBuffer` là một đối tượng biểu thị một vùng nhớ tĩnh, có thể được dùng để chứa dữ liệu thô như pixel của một hình ảnh. `SharedArrayBuffer` mở rộng chức năng này, cho phép nhiều luồng (main thread và workers) chia sẻ cùng một vùng bộ nhớ mà không cần sao chép [[199](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/SharedArrayBuffer)]. Điều này cực kỳ hữu ích cho việc truyền dữ liệu lớn giữa các worker, nhưng nó đi kèm với các yêu cầu bảo mật nghiêm ngặt (COOP/COEP) và các vấn đề lịch sử liên quan đến lỗ hổng Spectre [[125](https://www.reddit.com/r/WebAssembly/comments/rk83mr/wasm_threads_are_now_available_in_all_browsers/), [155](https://qouteall.fun/qouteall-blog/2025/WebAsembly%20Limitations)].
*   **Transferable Objects:** Đây là một cơ chế quan trọng để giảm thiểu sao chép. Khi gửi một `ArrayBuffer` qua `postMessage()` giữa `main thread` và `worker`, thay vì sao chép dữ liệu, bạn có thể "chuyển giao" quyền sở hữu của nó. Đối tượng nguồn sau khi chuyển giao sẽ trở nên vô hiệu (detached), và dữ liệu được chuyển đến đích một cách hiệu quả [[154](https://www.reddit.com/r/javascript/comments/1h3m2rv/askjs_reducing_web_worker_communication_overhead/), [200](https://tweag.io/blog/2022-11-24-wasm-threads-and-messages/)]. Đây là kỹ thuật bắt buộc phải sử dụng trong bất kỳ kiến trúc nào có sử dụng Web Workers.
*   **ImageBitmap & VideoFrame:** Đây là các đối tượng được trình duyệt quản lý, chứa dữ liệu hình ảnh/video. Chúng được thiết kế để làm việc hiệu quả với `OffscreenCanvas` và các API phần cứng khác. Một `VideoFrame` có thể được giải mã từ `VideoDecoder` và sau đó được vẽ lên `OffscreenCanvas` để chuyển đổi thành một dạng có thể xử lý trên GPU [[41](https://webrtchacks.com/video-frame-processing-on-the-web-webassembly-webgpu-webgl-webcodecs-webnn-and-webtransport/)].
*   **GPU Resources (GPUBuffer, GPUTexture):** Khi làm việc với WebGPU, dữ liệu được quản lý trên GPU thông qua các tài nguyên này. `GPUBuffer` là một khối bộ nhớ tuyến tính, trong khi `GPUTexture` là một cấu trúc dữ liệu 2D/3D. Việc sao chép giữa các tài nguyên này (ví dụ: `copyBufferToBuffer`, `copyTextureToBuffer`) là một thao tác có thể xảy ra, và thường là một trong những chi phí vận hành lớn nhất [[290](https://webgpufundamentals.org/webgpu/lessons/webgpu-optimization.html)].

**Thực trạng "Không sao chép" và Những Nơi Bắt Buộc Sao chép**

Mục tiêu "zero-copy" là một tham vọng, và trong thực tế, nó gần như không thể đạt được một cách hoàn hảo. Tuy nhiên, có thể xây dựng các luồng xử lý gần như không cần sao chép bằng cách kết hợp các công nghệ một cách khéo léo.

Một luồng xử lý gần như không cần sao chép lý tưởng trên iOS có thể trông như sau:
```text
Input Blob
   ↓ (createImageBitmap / new ImageDecoder)
ImageBitmap or VideoFrame
   ↓ (drawImageBitmap / OffscreenCanvas.getContext('bitmaprenderer'))
OffscreenCanvas ImageBitmap
   ↓ (OffscreenCanvas transferToImageBitmap / .transferToImageBitmap())
Transferred ImageBitmap
   ↓ (postMessage to Worker with transferable)
Worker Thread
   ↓ (convert to GPUTexture via OffscreenCanvas)
GPUTexture
   ↓ (WebGPU Compute Shader Processing)
Processed GPUTexture
   ↓ (copyTextureToBuffer to GPUBuffer)
GPUBuffer (containing processed pixels)
   ↓ (postMessage back to main thread with transferable)
Main Thread
   ↓ (pass to Rust/WASM for encoding)
```
Trong luồng này, các bước sao chép đã được giảm thiểu đáng kể:
1.  **Nhập:** Sử dụng `createImageBitmap` để tránh sao chép toàn bộ tệp vào `ArrayBuffer`.
2.  **Chuyển đến Canvas:** Sử dụng `OffscreenCanvas` để làm trung gian.
3.  **Chuyển giữa Main và Worker:** Sử dụng `transferable` objects để chuyển `ImageBitmap` giữa các luồng mà không cần sao chép.
4.  **GPU Processing:** Làm việc trực tiếp với `GPUTexture`.

Tuy nhiên, vẫn có những nơi bắt buộc phải có sao chép:
*   **CPU ↔ GPU Data Transfer:** Đây là nơi sao chép không thể tránh khỏi. Khi chuyển dữ liệu từ một `ArrayBuffer` JavaScript sang một `GPUBuffer`, hoặc từ một `GPUTexture` về một `GPUBuffer` để đọc lại trên CPU, một lần copy giữa bộ nhớ hệ thống và VRAM là cần thiết [[290](https://webgpufundamentals.org/webgpu/lessons/webgpu-optimization.html)]. Trên các hệ thống tách rời, chi phí này rất cao. Nhưng trên Apple Silicon với UMA, vì CPU và GPU chia sẻ cùng một không gian địa chỉ, chi phí này được giảm đáng kể [[106](https://www.reddit.com/r/LocalLLM/comments/1mw7vy8/can_someone_explain_technically_why_apple_shared/), [144](https://arxiv.org/pdf/2501.14925)]. Điều này là một lợi thế cạnh tranh lớn cho các pipeline hybrid (WebGPU + WASM) trên các thiết bị Apple mới.
*   **WebCodecs ↔ WebGPU Bridge:** Đây là một rào cản lớn nhất. Hiện tại, không có API trực tiếp nào cho phép chuyển một `VideoFrame` vào WebGPU. Cách phổ biến nhất là `videoFrame.toImageBitmap()`, sau đó vẽ `ImageBitmap` lên `OffscreenCanvas` để lấy `GPUTexture`. Quá trình này tạo ra ít nhất một lần copy trong trình duyệt [[41](https://webrtchacks.com/video-frame-processing-on-the-web-webassembly-webgpu-webgl-webcodecs-webnn-and-webtransport/)]. Đây là một điểm yếu nghiêm trọng trong kiến trúc hiện tại và là một khu vực cần cải tiến trong các phiên bản tương lai của WebCodecs.

**Ảnh Hưởng của Hệ Sinh Thái Apple**

Hệ sinh thái của Apple cung cấp một số lợi thế độc đáo cho việc quản lý bộ nhớ:
*   **Unified Memory Architecture (UMA):** Như đã nêu, UMA giúp giảm chi phí sao chép giữa CPU và GPU, khiến cho các pipeline xử lý lai trở nên hiệu quả hơn bao giờ hết [[106](https://www.reddit.com/r/LocalLLM/comments/1mw7vy8/can_someone_explain_technically_why_apple_shared/), [144](https://arxiv.org/pdf/2501.14925)].
*   **Memory Limits & Throttling:** Safari trên iOS có một giới hạn bộ nhớ cho mỗi tab (khoảng 1.5GB) [[55](https://github.com/mlc-ai/web-llm/issues/386)]. Hơn nữa, iOS có thể tạm dừng các tab nền hoặc giới hạn tài nguyên của chúng để tiết kiệm pin và quản lý nhiệt độ [[215](https://webkit.org/blog/8970/how-web-content-can-affect-power-usage/)]. Một kiến trúc xử lý phương tiện phải được thiết kế với ý thức về những giới hạn này, tránh giữ lại các tài nguyên không cần thiết và giải phóng chúng kịp thời.
*   **VideoToolbox & HEIC:** Đối với hình ảnh HEIC, trình duyệt có thể giải mã chúng thành `VideoFrame` một cách hiệu quả, tận dụng VideoToolbox mà không cần phải chuyển đổi sang `ImageBitmap` ngay lập tức, giúp giảm tải bộ nhớ [[73](https://dev.to/video/working-with-videotoolbox-for-more-control-over-video-encoding-and-decoding-6n1)].

Tóm lại, để xây dựng một kiến trúc gần như không có sao chép, developer cần phải:
1.  Tận dụng triệt để `Transferable Objects` giữa các luồng.
2.  Sử dụng `SharedArrayBuffer` một cách cẩn trọng (với COOP/COEP) cho các tác vụ đa luồng.
3.  Ưu tiên luồng xử lý trên GPU (WebGPU) để giữ dữ liệu trong VRAM càng lâu càng tốt.
4.  Chuẩn bị cho việc sao chép bắt buộc giữa GPU và CPU, và tận dụng UMA của Apple Silicon để giảm thiểu chi phí.
5.  Theo dõi sát sao sự phát triển của WebCodecs để nắm bắt các cải tiến trong việc kết nối với WebGPU.

## Triển khai Thực tiễn: Benchmark, Fallback, và Chiến lược iOS

Thiết kế một kiến trúc lý thuyết là một nửa công việc; nửa còn lại là triển khai nó một cách thực tiễn, bao gồm việc xây dựng một hệ thống benchmark mạnh mẽ, một cơ chế fallback an toàn, và một chiến lược nhạy bén với các đặc thù của nền tảng iOS. Đây là những yếu tố quyết định sự thành công của một ứng dụng xử lý phương tiện phía client trong thế giới thực.

**Thiết kế Framework Benchmark**

Để tự động chọn backend tối ưu, cần một bộ benchmark vi mô được thực hiện tại thời điểm khởi tạo. Framework này phải đo lường các chỉ số quan trọng ngoài thời gian thực thi, đặc biệt là hiệu suất trên mỗi watt. Các metric cần đo bao gồm:
*   **Time-based Metrics:** Thời gian giải mã, tiền xử lý, mã hóa, và tổng thời gian cho một tác vụ. Các tác vụ này nên được thực hiện trên nhiều kích thước dữ liệu khác nhau (ví dụ: ảnh 720p, 1080p, 4K) để đánh giá hiệu suất ở các mức tải khác nhau .
*   **Resource-based Metrics:** Sử dụng Performance API của trình duyệt để đo lường CPU utilization và GPU workload (frame time, draw call count) [[67](https://digitalstrategyforce.com/journal/what-are-gpu-performance-budgets-and-how-do-you-optimize-render-pipelines/)]. Các công cụ như Instruments trên macOS cũng có thể được sử dụng để giám sát sâu hơn hiệu suất CPU/GPU của ứng dụng Safari [[179](https://developer.apple.com/videos/play/wwdc2025/308/)].
*   **Memory-based Metrics:** Đo peak memory usage và average memory usage. Điều này đặc biệt quan trọng trên iOS, nơi bộ nhớ là tài nguyên hạn chế [[55](https://github.com/mlc-ai/web-llm/issues/386)]. Có thể sử dụng `performance.memory` API (nếu có) hoặc các heuristic để ước lượng.
*   **Energy Proxy Metrics:** Vì không thể đo pin chính xác, cần sử dụng các proxy gián tiếp. Một trong những proxy tốt nhất là **thermal throttling**. Bằng cách chạy một tác vụ nặng liên tục và đo hiệu suất theo thời gian, ta có thể phát hiện sự suy giảm hiệu suất do thiết bị bị nóng lên [[99](https://joanleon.dev/en/webgpu-browser-performance/), [293](https://arxiv.org/pdf/2512.22180)]. Một pipeline không bị throttling nhanh chóng hoặc không bị mất hiệu suất sau một vài giây hoạt động bền bỉ được coi là hiệu quả về năng lượng hơn. Các benchmark này phải được chạy trên một ma trận thiết bị đa dạng.

**Ma trận Kiểm thử (Test Matrix)**

Không thể đảm bảo hiệu suất trên tất cả các thiết bị chỉ bằng kiểm thử trên một chiếc iPhone. Ma trận kiểm thử phải bao gồm các thiết bị đại diện cho các phân khúc khác nhau:
*   **Low-end / Older:** Ví dụ: iPhone SE (thế hệ cũ), iPhone 8, hoặc iPad đời cũ. Những thiết bị này thường có chip A-series cũ hơn, RAM hạn chế và có thể không hỗ trợ các API mới nhất.
*   **Mid-range:** Ví dụ: iPhone 13/14 series, iPad Air. Đây là các thiết bị phổ biến, có chip A-series tầm trung.
*   **High-end:** Ví dụ: iPhone 15 Pro Max, iPad Pro (M-series chip). Những thiết bị này có sức mạnh phần cứng đỉnh cao và hỗ trợ đầy đủ các API mới nhất.
*   **iPadOS Devices:** Các máy tính bảng có màn hình lớn hơn và có thể có chip Pro-class (M-series), cần được kiểm tra riêng để xem xét các kịch bản sử dụng khác biệt (ví dụ: Stage Manager, Windowed Apps có thể ảnh hưởng đến hiệu suất và nhiệt độ) [[212](https://www.reddit.com/r/iPadOS/comments/1sy0rh6/ipados_26_destroyed_battery_life/)].

**Cơ chế Fallback Hybrid Linh hoạt**

Thay vì một fallback đơn giản "WebGPU fail, use WASM", kiến trúc nên có một chiến lược phân tầng và linh hoạt. Một thuật toán lựa chọn backend tự động có thể được thiết kế như sau:
1.  **Phát hiện Khả năng:** Kiểm tra sự tồn tại của `navigator.gpu`, `VideoEncoder`, WASM SIMD, WASM Threads.
2.  **Kiểm tra Codec:** Sử dụng `isConfigSupported` để xác định các codec được hỗ trợ bởi phần cứng.
3.  **Benchmark Vi Mô:** Chạy các benchmark nhỏ cho các tác vụ quan trọng (resize, color convert, encoder/decoder đơn giản).
4.  **Lựa chọn Pipeline:**
    *   **Nếu WebGPU và WebCodecs đều sẵn sàng và hỗ trợ codec mong muốn:** Chọn pipeline `WebGPU + WebCodecs`.
    *   **Nếu WebGPU không ổn định hoặc benchmark cho thấy chi phí truyền dữ liệu quá cao:** Chuyển sang pipeline `WASM SIMD + WebCodecs`.
    *   **Nếu WebGPU không khả dụng nhưng WebCodecs thì có:** Chọn pipeline `WASM SIMD Preprocessing + WebCodecs`.
    *   **Nếu cả WebGPU và WebCodecs đều không khả dụng (hoặc codec không được hỗ trợ):** Chuyển sang pipeline `FFmpeg.wasm` hoặc một codec WASM khác.
    *   **Nếu mọi thứ đều thất bại:** Trả về một fallback JS thuần (nếu có thể) hoặc thông báo lỗi.

**Chiến lược cho iOS: Đơn Giản hóa và Tối Ưu Hóa**

iOS không phải là một môi trường web bình thường. Chiến lược triển khai cho iOS phải đặc biệt chú ý đến các điểm sau:
*   **WebKit là Động cơ:** Mọi trình duyệt trên iOS, kể cả Chrome và Edge, đều sử dụng WebKit. Điều này có nghĩa là các tính năng và benchmark phải được kiểm tra trên WebKit, không phải Chromium [[16](https://news.ycombinator.com/item?id=26259056), [309](https://medium.com/@hashbyt/webassembly-vs-javascript-the-performance-battle-b2936d4c6c03)].
*   **WebGPU là Mấu chốt:** Với WebGPU đã được kích hoạt trên Safari 26+, đây là cơ hội vàng để tận dụng sức mạnh của Apple GPU. Nên ưu tiên các tác vụ phù hợp với WebGPU và tận dụng việc nó là một wrapper trực tiếp cho Metal để tối ưu hóa hiệu suất và năng lượng [[107](https://dev.to/arshtechpro/wwdc-2025-webgpu-on-apple-platforms-16pa)].
*   **WebCodecs là Chìa khóa:** Dù sao đi nữa, WebCodecs vẫn là lựa chọn hàng đầu cho việc mã hóa/giải mã video nhờ khả năng phần cứng. Cần kiểm tra `decodingInfo` để xác định hỗ trợ AV1/VP9 một cách chính xác [[23](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Formats/Video_codecs), [222](https://webkit.org/blog/17896/release-notes-for-safari-technology-preview-240/)].
*   **Quản lý Nhiệt độ và Pin:** Đây là kẻ thù số một. Ứng dụng phải được thiết kế để chịu đựng được tình trạng bị giới hạn hiệu suất do quá nhiệt. Các tác vụ nặng nên được chia nhỏ và thực hiện trong nhiều khung hình, thay vì một lần duy nhất. Theo dõi hiệu suất theo thời gian và điều chỉnh tải công việc nếu phát hiện sự suy giảm đột ngột là một kỹ thuật cần thiết [[99](https://joanleon.dev/en/webgpu-browser-performance/), [293](https://arxiv.org/pdf/2512.22180)].
*   **Các trường hợp ngoại lệ iOS:**
    *   **HEIC Input:** Sử dụng `ImageDecoder` hoặc `createImageBitmap` để giải mã HEIC một cách hiệu quả.
    *   **Camera Access:** Camera trên iOS có thể bị giới hạn bởi hai lớp kiểm soát quyền riêng tư (OS level và browser level), gây ra độ trễ và khó khăn trong việc cấp quyền [[66](https://isazeni.com/how-do-i-allow-camera-access-in-chrome-or-edge/)].
    *   **HDR & Wide Color Gamut:** Ứng dụng cần xử lý đúng các thông tin metadata EXIF và Display-P3 để hiển thị màu sắc chính xác [[27](https://developer.apple.com/videos/play/wwdc2023/10122/)].

**Kết luận và Stack Đề xuất Cuối Cùng**

Sau khi phân tích toàn diện, stack công nghệ tối ưu để xây dựng một media processing engine phía client trên iOS/iPadOS là một sự kết hợp của các công nghệ mạnh mẽ, được phân chia công việc một cách thông minh:

**Stack Được Đề Xuất:**
```text
Rust
+
WASM SIMD (cho các tác vụ CPU-bound, logic tuần tự như mã hóa lossless)
+
WASM Threads + SharedArrayBuffer (nếu được hỗ trợ và cấu hình COOP/COEP)
+
WebGPU (cho tiền/xử lý song song hóa khối lượng lớn)
+
WebCodecs (cho giải mã/nén phần cứng video)
+
Web Workers (để tách biệt luồng xử lý khỏi UI thread)
```

**Lý do lựa chọn:**
1.  **Tối ưu hóa Hiệu suất trên Watt:** Stack này không chỉ tìm kiếm tốc độ tuyệt đối mà là hiệu suất trên mỗi watt. Bằng cách phân chia công việc một cách hợp lý—dùng GPU cho những gì GPU giỏi nhất (song song hóa) và dùng CPU/Rust/WASM cho những gì CPU giỏi nhất (logic tuần tự, codec)—nó đảm bảo ứng dụng hoạt động hiệu quả nhất có thể trên mỗi thiết bị.
2.  **Tính toàn vẹn Dữ liệu:** Việc giữ các encoder lossless phức tạp như WebP trong WASM cho phép kiểm soát tuyệt đối và đảm bảo tính toàn vẹn dữ liệu, không phụ thuộc vào các API codec còn đang trong quá trình phát triển.
3.  **Tính tương thích và Khả năng mở rộng:** Kiến trúc phân tầng và cơ chế benchmark/fallback tự động đảm bảo rằng ứng dụng vẫn có thể hoạt động và cung cấp trải nghiệm tốt nhất có thể trên toàn bộ dải sản phẩm iOS, từ các thiết bị cũ đến mới nhất.
4.  **Tận dụng Hệ sinh thái Apple:** Stack này được xây dựng trên các nền tảng cốt lõi của Apple: Metal (qua WebGPU), Unified Memory Architecture (giúp giảm chi phí sao chép), và các nhân CPU mạnh mẽ. Nó không chống lại hệ sinh thái mà tìm cách hòa mình và tận dụng nó một cách tối đa.

Đây không phải là một danh sách các công nghệ rời rạc, mà là một bản đồ chiến lược, một lộ trình hành động chi tiết để xây dựng một engine xử lý phương tiện phía client mạnh mẽ, hiệu quả và bền vững, đáp ứng chính xác các yêu cầu khắt khe của nền tảng iOS/iPadOS.