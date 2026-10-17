import { getTranslations, setRequestLocale } from "next-intl/server";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/db/client";
import { getPrice, requiredSolFor } from "@/lib/payment/pricing";
import { getActiveWallet } from "@/lib/solana/wallet";
import { CreateTokenWizard } from "@/components/create/wizard";

export default async function CreatePage({ params }: PageProps<"/[locale]/create">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("create");
  const user = await requireUser();
  if (!user) redirect("/login");

  const [price, poolPrice, wallet] = await Promise.all([
    getPrice("create_token"),
    getPrice("create_pool"),
    getActiveWallet(user.id).catch(() => null),
  ]);
  const kind = wallet?.kind ?? ("mainnet" as const);

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-8 text-4xl sm:text-5xl">{t("title")}</h1>
      <CreateTokenWizard
        priceUsdc={price.amount_usdc ?? 2}
        poolFeeUsdc={poolPrice.amount_usdc ?? 10}
        gasCreateSol={requiredSolFor("create_token")}
        gasPoolSol={requiredSolFor("create_pool")}
        kind={kind}
      />
    </div>
  );
}
