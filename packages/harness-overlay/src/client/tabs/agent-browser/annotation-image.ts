import type {
  AgentBrowserNumberedComment,
} from "./chat.ts";

const MAX_ANNOTATED_SCREENSHOT_BASE64_LENGTH = 8 * 1024 * 1024;

function loadScreenshot(
  screenshot: {
    readonly mimeType: "image/png";
    readonly data: string;
  },
): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () =>
      reject(new Error("Could not decode the browser screenshot"));
    image.src =
      `data:${screenshot.mimeType};base64,${screenshot.data}`;
  });
}

function clamp(
  value: number,
  minimum: number,
  maximum: number,
): number {
  return Math.max(minimum, Math.min(maximum, value));
}

/**
 * Burn stable numbered DOM ranges into a captured guest viewport.
 *
 * CDP coordinates are CSS pixels; deriving each axis from the decoded PNG
 * avoids guessing the guest devicePixelRatio or visual-viewport scale.
 */
export async function composeAgentBrowserAnnotationImage(
  screenshot: {
    readonly mimeType: "image/png";
    readonly data: string;
  },
  comments: readonly AgentBrowserNumberedComment[],
): Promise<string> {
  const image = await loadScreenshot(screenshot);
  if (image.naturalWidth <= 0 || image.naturalHeight <= 0) {
    throw new Error("The browser screenshot is empty");
  }
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d");
  if (context === null) {
    throw new Error("Browser annotation canvas is unavailable");
  }
  context.drawImage(image, 0, 0);

  for (const comment of comments) {
    const { rect, viewport } = comment.target;
    const scaleX = canvas.width / viewport.width;
    const scaleY = canvas.height / viewport.height;
    const scale = Math.max(1, Math.min(scaleX, scaleY));
    const x = rect.x * scaleX;
    const y = rect.y * scaleY;
    const width = rect.width * scaleX;
    const height = rect.height * scaleY;
    const lineWidth = Math.max(2, 2 * scale);

    context.save();
    context.fillStyle = "rgba(16, 112, 255, 0.10)";
    context.strokeStyle = "#0878ff";
    context.lineWidth = lineWidth;
    context.fillRect(x, y, width, height);
    context.strokeRect(
      x + lineWidth / 2,
      y + lineWidth / 2,
      Math.max(0, width - lineWidth),
      Math.max(0, height - lineWidth),
    );

    const radius = 11 * scale;
    const markerX = clamp(
      x + width,
      radius + lineWidth,
      canvas.width - radius - lineWidth,
    );
    const markerY = clamp(
      y + Math.min(height / 2, 22 * scale),
      radius + lineWidth,
      canvas.height - radius - lineWidth,
    );
    context.beginPath();
    context.arc(markerX, markerY, radius, 0, Math.PI * 2);
    context.fillStyle = "#0878ff";
    context.fill();
    context.strokeStyle = "#ffffff";
    context.lineWidth = Math.max(2, 2 * scale);
    context.stroke();
    context.fillStyle = "#ffffff";
    context.font =
      `700 ${String(Math.round(12 * scale))}px system-ui, sans-serif`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(String(comment.index), markerX, markerY + scale);
    context.restore();
  }

  const dataUrl = canvas.toDataURL("image/png");
  const prefix = "data:image/png;base64,";
  if (!dataUrl.startsWith(prefix)) {
    throw new Error("Could not encode the annotated browser screenshot");
  }
  const data = dataUrl.slice(prefix.length);
  if (
    data === "" ||
    data.length > MAX_ANNOTATED_SCREENSHOT_BASE64_LENGTH ||
    !/^[a-zA-Z0-9+/]+={0,2}$/u.test(data)
  ) {
    throw new Error("The annotated browser screenshot is too large");
  }
  return data;
}
