import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { parseAuthorizeParams, matchRedirectUri, errorRedirect } from "@/lib/oauth/params";
import { findClient } from "@/lib/oauth/server";
import { ConsentForm } from "@/components/oauth/ConsentForm";

/**
 * 同意畫面。
 *
 * 錯誤的處理順序是刻意的:client 與 redirect_uri 驗過之前,一律把錯誤顯示
 * 在這一頁,**不往那個網址導** —— 還沒驗證就導過去,等於做了一個開放轉址,
 * 任何人都能拿這支端點把別人送去任意網站。驗過之後才照規格用 error 參數
 * 導回用戶端。
 */
export default async function AuthorizePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string") params.set(key, value);
  }

  const parsed = parseAuthorizeParams(params);
  if (!parsed.ok) return <Problem title="授權請求有問題" detail={parsed.description} />;

  const client = await findClient(parsed.value.clientId);
  if (!client) return <Problem title="找不到這個應用程式" detail="client_id 沒有註冊過。" />;

  if (!matchRedirectUri(client.redirectUris, parsed.value.redirectUri)) {
    // 對不上就停在這裡。導過去正是這一關要防的事。
    return (
      <Problem
        title="導向網址不符"
        detail="這個 redirect_uri 沒有登記在這個應用程式底下,為了安全不會把你導過去。"
      />
    );
  }

  const session = await getSession();
  if (!session) {
    // 先登入再回來 —— 原本的查詢參數整包帶著走,授權流程才不會斷。
    const back = `/oauth/authorize?${params.toString()}`;
    redirect(`/login?next=${encodeURIComponent(back)}`);
  }

  return (
    <ConsentForm
      clientName={client.name}
      clientId={parsed.value.clientId}
      redirectUri={parsed.value.redirectUri}
      state={parsed.value.state}
      codeChallenge={parsed.value.codeChallenge}
      resource={parsed.value.resource}
      userName={session.name}
      userRole={session.role}
      denyUrl={errorRedirect(
        parsed.value.redirectUri,
        "access_denied",
        "使用者拒絕授權",
        parsed.value.state
      )}
    />
  );
}

function Problem({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="mx-auto max-w-md p-8">
      <h1 className="mb-2 text-lg font-semibold text-red-700 dark:text-red-400">{title}</h1>
      <p className="text-sm text-neutral-600 dark:text-neutral-300">{detail}</p>
    </div>
  );
}
