"use client";

import { useTranslation } from "react-i18next";

import { LegalDocument } from "@/features/legal/components/LegalDocument";
import { dataPolicyValues } from "@/features/legal/lib/values";

/** What personal information Wat2Do handles, why, and the choices people have about it. */
export function DataPolicyPage() {
  const { i18n } = useTranslation();
  return <LegalDocument name="dataPolicy" values={dataPolicyValues(i18n.language)} />;
}
