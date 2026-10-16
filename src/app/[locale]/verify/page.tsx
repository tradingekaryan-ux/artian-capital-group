import { getTranslations, setRequestLocale } from "next-intl/server";
import { VerifyForm } from "@/components/verify-form";

export default async function VerifyPage({ params }: PageProps<"/[locale]/verify">) {
  const { locale } = await params;
  setRequestLocale(locale);
  await getTranslations("auth");
  return <VerifyForm />;
}
