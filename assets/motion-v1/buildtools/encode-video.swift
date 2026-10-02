import AVFoundation
import CoreGraphics
import CoreVideo
import ImageIO
import Foundation

let args = CommandLine.arguments
if args.count != 3 { fputs("usage: encode-video.swift FRAME_DIR OUTPUT.mp4\n", stderr); exit(2) }
let dir = URL(fileURLWithPath: args[1])
let output = URL(fileURLWithPath: args[2])
try? FileManager.default.removeItem(at: output)
let frames = try FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil)
  .filter { $0.pathExtension == "png" }.sorted { $0.lastPathComponent < $1.lastPathComponent }
guard let first = frames.first,
      let source = CGImageSourceCreateWithURL(first as CFURL, nil),
      let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else { fatalError("No readable PNG frames") }
let width = image.width, height = image.height
let writer = try AVAssetWriter(outputURL: output, fileType: .mp4)
let input = AVAssetWriterInput(mediaType: .video, outputSettings: [
  AVVideoCodecKey: AVVideoCodecType.h264,
  AVVideoWidthKey: width,
  AVVideoHeightKey: height,
  AVVideoCompressionPropertiesKey: [AVVideoAverageBitRateKey: 4_000_000]
])
input.expectsMediaDataInRealTime = false
let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: [
  kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
  kCVPixelBufferWidthKey as String: width,
  kCVPixelBufferHeightKey as String: height,
  kCVPixelBufferCGImageCompatibilityKey as String: true,
  kCVPixelBufferCGBitmapContextCompatibilityKey as String: true
])
guard writer.canAdd(input) else { fatalError("Cannot add H.264 writer input") }
writer.add(input)
writer.startWriting()
writer.startSession(atSourceTime: .zero)
for (index, url) in frames.enumerated() {
  while !input.isReadyForMoreMediaData { Thread.sleep(forTimeInterval: 0.002) }
  guard let src = CGImageSourceCreateWithURL(url as CFURL, nil), let frame = CGImageSourceCreateImageAtIndex(src, 0, nil) else { fatalError("Bad frame: \(url)") }
  var buffer: CVPixelBuffer?
  let status = CVPixelBufferCreate(kCFAllocatorDefault, width, height, kCVPixelFormatType_32BGRA,
    [kCVPixelBufferCGImageCompatibilityKey as String: true,
     kCVPixelBufferCGBitmapContextCompatibilityKey as String: true,
     kCVPixelBufferWidthKey as String: width,
     kCVPixelBufferHeightKey as String: height,
     kCVPixelBufferIOSurfacePropertiesKey as String: [:]] as CFDictionary, &buffer)
  guard status == kCVReturnSuccess, let pixel = buffer else { fatalError("Pixel buffer allocation failed: \(status)") }
  CVPixelBufferLockBaseAddress(pixel, [])
  let context = CGContext(data: CVPixelBufferGetBaseAddress(pixel), width: width, height: height, bitsPerComponent: 8,
    bytesPerRow: CVPixelBufferGetBytesPerRow(pixel), space: CGColorSpaceCreateDeviceRGB(),
    bitmapInfo: CGBitmapInfo.byteOrder32Little.rawValue | CGImageAlphaInfo.premultipliedFirst.rawValue)!
  context.draw(frame, in: CGRect(x: 0, y: 0, width: width, height: height))
  CVPixelBufferUnlockBaseAddress(pixel, [])
  let time = CMTime(value: Int64(index), timescale: 12)
  guard adaptor.append(pixel, withPresentationTime: time) else { fatalError("Video frame append failed: \(writer.error?.localizedDescription ?? "unknown")") }
}
input.markAsFinished()
let done = DispatchSemaphore(value: 0)
writer.finishWriting { done.signal() }
done.wait()
if writer.status != .completed { fatalError("H.264 write failed: \(writer.error?.localizedDescription ?? "unknown")") }
