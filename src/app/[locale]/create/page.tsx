import { getTranslations, setRequestLocale } from "next-intl/server";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/db/client";
import { getPrice } from "@/lib/payment/pricing";
import { CreateTokenWizard } from "@/components/create/wizard";

export default async function CreatePage({ params }: PageProps<"/[locale]/create">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("create");
  const user = await requireUser();
  if (!user) redirect(`/${locale}/login`);

  const price = await getPrice("create_token");

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-8 text-4xl sm:text-5xl">{t("title")}</h1>
      <CreateTokenWizard priceUsdc={price.amount_usdc ?? 2} />
    </div>
  );
}
