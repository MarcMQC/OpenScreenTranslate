#import <AppKit/AppKit.h>
#import <CoreGraphics/CoreGraphics.h>
#import <Foundation/Foundation.h>
#import <ImageIO/ImageIO.h>
#import <ScreenCaptureKit/ScreenCaptureKit.h>
#import <Vision/Vision.h>

#include <float.h>
#include <math.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <unistd.h>

typedef struct {
  size_t pixel_width;
  size_t pixel_height;
} OSTCaptureMetadata;

static void ost_write_error(char *buffer, size_t buffer_length, NSString *message) {
  if (buffer == NULL || buffer_length == 0) {
    return;
  }

  const char *utf8 = message.UTF8String;
  snprintf(buffer, buffer_length, "%s", utf8 != NULL ? utf8 : "unknown native capture error");
}

static double ost_distance_squared_to_rect(CGPoint point, CGRect rect) {
  const double left = CGRectGetMinX(rect);
  const double right = CGRectGetMaxX(rect);
  const double top = CGRectGetMinY(rect);
  const double bottom = CGRectGetMaxY(rect);
  const double dx = point.x < left ? left - point.x : (point.x > right ? point.x - right : 0.0);
  const double dy = point.y < top ? top - point.y : (point.y > bottom ? point.y - bottom : 0.0);
  return dx * dx + dy * dy;
}

static CGDirectDisplayID ost_display_nearest_cursor(void) {
  CGEventRef event = CGEventCreate(NULL);
  const CGPoint cursor = event != NULL ? CGEventGetLocation(event) : CGPointZero;
  if (event != NULL) {
    CFRelease(event);
  }

  uint32_t display_count = 0;
  if (CGGetActiveDisplayList(0, NULL, &display_count) != kCGErrorSuccess || display_count == 0) {
    return 0;
  }

  CGDirectDisplayID *displays = calloc(display_count, sizeof(CGDirectDisplayID));
  if (displays == NULL) {
    return 0;
  }

  if (CGGetActiveDisplayList(display_count, displays, &display_count) != kCGErrorSuccess) {
    free(displays);
    return 0;
  }

  CGDirectDisplayID nearest = displays[0];
  double nearest_distance = DBL_MAX;
  for (uint32_t index = 0; index < display_count; index++) {
    const CGRect bounds = CGDisplayBounds(displays[index]);
    const double distance = ost_distance_squared_to_rect(cursor, bounds);
    if (distance < nearest_distance) {
      nearest = displays[index];
      nearest_distance = distance;
    }
  }

  free(displays);
  return nearest;
}

bool ost_has_screen_capture_permission(void) {
  return CGPreflightScreenCaptureAccess();
}

bool ost_request_screen_capture_permission(void) {
  return CGRequestScreenCaptureAccess();
}

bool ost_open_screen_capture_settings(void) {
  NSURL *url = [NSURL URLWithString:
      @"x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"];
  return url != nil && [[NSWorkspace sharedWorkspace] openURL:url];
}

void ost_configure_capture_window(void *window_pointer) {
  if (window_pointer == NULL) {
    return;
  }

  NSWindow *window = (__bridge NSWindow *)window_pointer;
  window.opaque = NO;
  window.backgroundColor = NSColor.clearColor;
  window.animationBehavior = NSWindowAnimationBehaviorNone;
  window.level = NSScreenSaverWindowLevel;
  window.collectionBehavior = NSWindowCollectionBehaviorMoveToActiveSpace |
                              NSWindowCollectionBehaviorCanJoinAllApplications |
                              NSWindowCollectionBehaviorFullScreenAuxiliary |
                              NSWindowCollectionBehaviorTransient |
                              NSWindowCollectionBehaviorFullScreenDisallowsTiling |
                              NSWindowCollectionBehaviorIgnoresCycle;
  window.hidesOnDeactivate = NO;
  window.hasShadow = NO;
}

void ost_present_capture_window(void *window_pointer) {
  if (window_pointer == NULL) {
    return;
  }

  NSWindow *window = (__bridge NSWindow *)window_pointer;
  [NSApp activate];
  [window makeKeyAndOrderFront:nil];
}

void ost_configure_result_window(void *window_pointer) {
  if (window_pointer == NULL) {
    return;
  }

  NSWindow *window = (__bridge NSWindow *)window_pointer;
  window.level = NSFloatingWindowLevel;
  window.styleMask &= ~NSWindowStyleMaskResizable;
  [[window standardWindowButton:NSWindowZoomButton] setEnabled:NO];
  window.collectionBehavior = NSWindowCollectionBehaviorMoveToActiveSpace |
                              NSWindowCollectionBehaviorCanJoinAllApplications |
                              NSWindowCollectionBehaviorFullScreenAuxiliary |
                              NSWindowCollectionBehaviorTransient |
                              NSWindowCollectionBehaviorFullScreenDisallowsTiling |
                              NSWindowCollectionBehaviorIgnoresCycle;
  window.hidesOnDeactivate = NO;
}

bool ost_copy_text_to_clipboard(const char *text) {
  if (text == NULL) {
    return false;
  }

  NSString *value = [NSString stringWithUTF8String:text];
  if (value == nil) {
    return false;
  }

  NSPasteboard *pasteboard = [NSPasteboard generalPasteboard];
  [pasteboard clearContents];
  return [pasteboard setString:value forType:NSPasteboardTypeString];
}

static bool ost_write_png(CGImageRef image, NSURL *url) {
  CGImageDestinationRef destination = CGImageDestinationCreateWithURL(
      (__bridge CFURLRef)url, CFSTR("public.png"), 1, NULL);
  if (destination == NULL) {
    return false;
  }

  CGImageDestinationAddImage(destination, image, NULL);
  const bool finalized = CGImageDestinationFinalize(destination);
  CFRelease(destination);
  return finalized;
}

int32_t ost_crop_and_recognize_text(const char *input_path,
                                    const char *crop_output_path,
                                    const char *text_output_path,
                                    double crop_x,
                                    double crop_y,
                                    double crop_width,
                                    double crop_height,
                                    char *error_buffer,
                                    size_t error_buffer_length) {
  @autoreleasepool {
    NSString *input = [NSString stringWithUTF8String:input_path];
    NSURL *input_url = input != nil ? [NSURL fileURLWithPath:input] : nil;
    CGImageSourceRef source = input_url != nil
        ? CGImageSourceCreateWithURL((__bridge CFURLRef)input_url, NULL)
        : NULL;
    if (source == NULL) {
      ost_write_error(error_buffer, error_buffer_length, @"unable to open captured image");
      return 10;
    }

    CGImageRef image = CGImageSourceCreateImageAtIndex(source, 0, NULL);
    CFRelease(source);
    if (image == NULL) {
      ost_write_error(error_buffer, error_buffer_length, @"unable to decode captured image");
      return 11;
    }

    const CGRect image_bounds = CGRectMake(
        0, 0, (CGFloat)CGImageGetWidth(image), (CGFloat)CGImageGetHeight(image));
    CGRect crop_rect = CGRectIntegral(CGRectMake(
        crop_x, crop_y, crop_width, crop_height));
    crop_rect = CGRectIntersection(image_bounds, crop_rect);
    if (CGRectIsEmpty(crop_rect) || crop_rect.size.width < 1 || crop_rect.size.height < 1) {
      CGImageRelease(image);
      ost_write_error(error_buffer, error_buffer_length, @"capture selection is outside the image");
      return 12;
    }

    CGImageRef cropped_image = CGImageCreateWithImageInRect(image, crop_rect);
    CGImageRelease(image);
    if (cropped_image == NULL) {
      ost_write_error(error_buffer, error_buffer_length, @"unable to crop selected image region");
      return 13;
    }

    NSString *crop_path = [NSString stringWithUTF8String:crop_output_path];
    NSURL *crop_url = crop_path != nil ? [NSURL fileURLWithPath:crop_path] : nil;
    if (crop_url == nil || !ost_write_png(cropped_image, crop_url)) {
      CGImageRelease(cropped_image);
      ost_write_error(error_buffer, error_buffer_length, @"unable to save cropped image");
      return 14;
    }

    VNRecognizeTextRequest *request = [[VNRecognizeTextRequest alloc] init];
    request.recognitionLevel = VNRequestTextRecognitionLevelAccurate;
    request.usesLanguageCorrection = YES;
    request.automaticallyDetectsLanguage = YES;

    VNImageRequestHandler *handler = [[VNImageRequestHandler alloc]
        initWithCGImage:cropped_image
        options:@{}];
    NSError *vision_error = nil;
    const BOOL performed = [handler performRequests:@[request] error:&vision_error];
    CGImageRelease(cropped_image);
    if (!performed) {
      ost_write_error(error_buffer, error_buffer_length,
                      vision_error.localizedDescription ?: @"Vision text recognition failed");
      return 15;
    }

    NSMutableArray<NSString *> *lines = [NSMutableArray array];
    for (VNRecognizedTextObservation *observation in request.results) {
      VNRecognizedText *candidate = [observation topCandidates:1].firstObject;
      if (candidate.string.length > 0) {
        [lines addObject:candidate.string];
      }
    }

    NSString *recognized_text = [lines componentsJoinedByString:@"\n"];
    NSString *text_path = [NSString stringWithUTF8String:text_output_path];
    NSURL *text_url = text_path != nil ? [NSURL fileURLWithPath:text_path] : nil;
    NSError *write_error = nil;
    const BOOL written = text_url != nil && [recognized_text
        writeToURL:text_url
        atomically:YES
        encoding:NSUTF8StringEncoding
        error:&write_error];
    if (!written) {
      ost_write_error(error_buffer, error_buffer_length,
                      write_error.localizedDescription ?: @"unable to save recognized text");
      return 16;
    }

    return 0;
  }
}

int32_t ost_capture_display_png(const char *output_path,
                                OSTCaptureMetadata *metadata,
                                char *error_buffer,
                                size_t error_buffer_length) {
  if (!CGPreflightScreenCaptureAccess()) {
    ost_write_error(error_buffer, error_buffer_length, @"screen recording permission is required");
    return 1;
  }

  const CGDirectDisplayID display_id = ost_display_nearest_cursor();
  if (display_id == 0) {
    ost_write_error(error_buffer, error_buffer_length, @"no active display is available");
    return 2;
  }

  dispatch_semaphore_t semaphore = dispatch_semaphore_create(0);
  __block CGImageRef captured_image = NULL;
  __block NSString *capture_error = nil;

  [SCShareableContent
      getShareableContentExcludingDesktopWindows:NO
                              onScreenWindowsOnly:YES
                                  completionHandler:^(SCShareableContent *content, NSError *error) {
    if (error != nil || content == nil) {
      capture_error = error.localizedDescription ?: @"unable to read shareable screen content";
      dispatch_semaphore_signal(semaphore);
      return;
    }

    SCDisplay *target_display = nil;
    for (SCDisplay *display in content.displays) {
      if (display.displayID == display_id) {
        target_display = display;
        break;
      }
    }

    if (target_display == nil) {
      capture_error = @"the selected display is not available to ScreenCaptureKit";
      dispatch_semaphore_signal(semaphore);
      return;
    }

    SCContentFilter *filter = [[SCContentFilter alloc]
        initWithDisplay:target_display
        excludingApplications:@[]
        exceptingWindows:@[]];
    SCStreamConfiguration *configuration = [[SCStreamConfiguration alloc] init];
    const CGFloat point_pixel_scale = MAX((CGFloat)filter.pointPixelScale, 1.0);
    configuration.width = (size_t)llround((CGFloat)target_display.width * point_pixel_scale);
    configuration.height = (size_t)llround((CGFloat)target_display.height * point_pixel_scale);
    configuration.captureResolution = SCCaptureResolutionBest;
    configuration.scalesToFit = YES;
    configuration.preservesAspectRatio = YES;
    configuration.shouldBeOpaque = YES;
    configuration.showsCursor = NO;

    [SCScreenshotManager captureImageWithFilter:filter
                                  configuration:configuration
                              completionHandler:^(CGImageRef image, NSError *screenshot_error) {
      if (image != NULL) {
        captured_image = CGImageRetain(image);
      } else {
        capture_error = screenshot_error.localizedDescription ?: @"ScreenCaptureKit returned no image";
      }
      dispatch_semaphore_signal(semaphore);
    }];
  }];

  dispatch_semaphore_wait(semaphore, DISPATCH_TIME_FOREVER);

  if (captured_image == NULL) {
    ost_write_error(error_buffer, error_buffer_length,
                    capture_error ?: @"screen capture failed without an error message");
    return 3;
  }

  NSString *path = [NSString stringWithUTF8String:output_path];
  NSURL *url = path != nil ? [NSURL fileURLWithPath:path] : nil;
  CGImageDestinationRef destination = url != nil
      ? CGImageDestinationCreateWithURL((__bridge CFURLRef)url, CFSTR("public.png"), 1, NULL)
      : NULL;

  if (destination == NULL) {
    CGImageRelease(captured_image);
    ost_write_error(error_buffer, error_buffer_length, @"unable to create PNG destination");
    return 4;
  }

  CGImageDestinationAddImage(destination, captured_image, NULL);
  const bool finalized = CGImageDestinationFinalize(destination);

  if (metadata != NULL) {
    metadata->pixel_width = CGImageGetWidth(captured_image);
    metadata->pixel_height = CGImageGetHeight(captured_image);
  }

  CFRelease(destination);
  CGImageRelease(captured_image);

  if (!finalized) {
    ost_write_error(error_buffer, error_buffer_length, @"unable to finalize captured PNG");
    return 4;
  }

  return 0;
}
