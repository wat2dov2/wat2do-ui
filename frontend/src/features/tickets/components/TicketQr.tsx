import { QRCodeSVG } from "qrcode.react";

// Large enough for a door scanner to read off a dimmed phone screen.
const QR_SIZE = 224;

/** A ticket's QR code. It always draws its own white quiet zone, so it scans in dark mode. */
export function TicketQr({ value, label }: { value: string; label: string }) {
  return (
    <QRCodeSVG
      value={value}
      size={QR_SIZE}
      level="M"
      marginSize={2}
      role="img"
      aria-label={label}
      title={label}
    />
  );
}
