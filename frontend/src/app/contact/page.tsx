import type { Metadata } from "next";
import { AppPage } from "@/app/app-page";
import imgContactHero from "@/assets/contact_hero.png";
import { ContactPage as ContactPageContent } from "@/features/contact/pages/ContactPage";
import {
  buildPublicPageMetadata,
  getBrandCanonicalUrl,
} from "@/shared/lib/seo";

const title = "About and Contact Wat2Do | Campus Event Discovery";
const description =
  "Meet the students behind Wat2Do, send a question or correction, and learn how Wat2Do helps students discover campus events and organizations.";

export const metadata: Metadata = buildPublicPageMetadata({
  title,
  description,
  canonicalUrl: getBrandCanonicalUrl("/contact"),
  image: {
    url: imgContactHero.src,
    alt: "Meet the Wat2Do campus event discovery team",
    width: imgContactHero.width,
    height: imgContactHero.height,
    type: "image/png",
  },
});

export default function ContactPage() {
  return (
    <AppPage>
      <ContactPageContent />
    </AppPage>
  );
}
