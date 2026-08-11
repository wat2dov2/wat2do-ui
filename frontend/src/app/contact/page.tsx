import type { Metadata } from "next";
import imgContactHero from "@/assets/contact_hero.png";
import { ContactPage as ContactPageContent } from "@/features/contact/pages/ContactPage";
import {
  buildPublicPageMetadata,
  getBrandCanonicalUrl,
} from "@/shared/lib/seo";

const title = "About and Contact Wat2Do | Campus Event Discovery";
const description =
  "Learn how Wat2Do's student founders built an Instagram event discovery system that has captured more than 3,000 University of Waterloo events since August 2025.";

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
  return <ContactPageContent />;
}
