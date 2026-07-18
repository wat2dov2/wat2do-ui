import Link from "next/link";

export function SiteHeader({
  audience,
}: {
  audience: "public" | "admin";
}) {
  return (
    <header className="page-header">
      <Link
        className="brand-lockup"
        href={audience === "admin" ? "/admin/studio" : "/"}
        aria-label={audience === "admin" ? "Waterloo Commons post studio" : "Waterloo Commons event submission"}
      >
        <span>WATERLOO</span>
        <strong>COMMONS</strong>
      </Link>

      {audience === "admin" && (
        <nav className="site-nav" aria-label="Curator navigation">
          <Link href="/feed">Feed</Link>
          <Link href="/admin/review">Review</Link>
          <Link href="/admin/studio">Studio</Link>
          <form action="/auth/sign-out" method="post">
            <button type="submit">Sign out</button>
          </form>
        </nav>
      )}
    </header>
  );
}
