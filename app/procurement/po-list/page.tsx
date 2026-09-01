import { redirect } from "next/navigation";

export default function PoListRedirectPage() {
  redirect("/procurement/po-approval");
}
