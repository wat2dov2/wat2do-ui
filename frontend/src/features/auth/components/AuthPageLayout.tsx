import type { ReactNode } from "react";
import { AuthCard } from "@/features/auth/components/AuthCard";
import { AuthHeroPanel } from "@/features/auth/components/AuthHeroPanel";
import type { PageHeaderBack } from "@/shared/layout";

interface AuthPageLayoutProps {
  heading: string;
  description: string;
  preview?: ReactNode;
  back?: PageHeaderBack;
  children?: ReactNode;
}

export function AuthPageLayout({
  heading,
  description,
  preview,
  back,
  children,
}: AuthPageLayoutProps) {
  return (
    <main className="min-h-screen">
      <div className="min-h-screen flex">
        <section className="w-full lg:w-[52%] px-6 py-10 flex justify-center items-center">
          <AuthCard heading={heading} description={description} back={back}>
            {children}
          </AuthCard>
        </section>

        {preview ?? <AuthHeroPanel />}
      </div>
    </main>
  );
}
