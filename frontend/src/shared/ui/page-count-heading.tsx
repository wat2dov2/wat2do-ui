import NumberFlow from "@number-flow/react";

interface PageCountHeadingProps {
  count: number;
  label: string;
}

export function PageCountHeading({ count, label }: PageCountHeadingProps) {
  return (
    <span className="inline-flex items-baseline gap-2 text-left text-2xl font-bold leading-none text-foreground sm:text-3xl">
      <NumberFlow value={count} respectMotionPreference={false} />
      <span>{label}</span>
    </span>
  );
}
