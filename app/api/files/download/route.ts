import { NextResponse } from "next/server";
import { verifyFirebaseRequest } from "@/lib/firebase-admin";
import { safeFileName } from "@/lib/utils";

const allowedHost = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME ? `res.cloudinary.com` : null;

function getFileName(url: URL) {
  const lastSegment = url.pathname.split("/").filter(Boolean).at(-1) ?? "comms-file";
  return safeFileName(decodeURIComponent(lastSegment));
}

export async function GET(request: Request) {
  try {
    await verifyFirebaseRequest(request);
    const requestUrl = new URL(request.url);
    const target = requestUrl.searchParams.get("url");
    if (!target) return NextResponse.json({ message: "Missing file URL." }, { status: 400 });

    const fileUrl = new URL(target);
    const cloudName = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
    if (fileUrl.protocol !== "https:" || fileUrl.hostname !== allowedHost || (cloudName && !fileUrl.pathname.startsWith(`/${cloudName}/`))) {
      return NextResponse.json({ message: "This file source is not allowed." }, { status: 400 });
    }

    const response = await fetch(fileUrl);
    if (!response.ok || !response.body) {
      return NextResponse.json(
        {
          message:
            "Cloudinary blocked this file. In Cloudinary Console, enable Security > Allow delivery of PDF and ZIP files, then re-upload or retry."
        },
        { status: 502 }
      );
    }

    return new NextResponse(response.body, {
      headers: {
        "Content-Type": response.headers.get("content-type") ?? "application/octet-stream",
        "Content-Disposition": `inline; filename="${getFileName(fileUrl)}"`,
        "Cache-Control": "private, max-age=300"
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not open file.";
    return NextResponse.json({ message }, { status: 401 });
  }
}
