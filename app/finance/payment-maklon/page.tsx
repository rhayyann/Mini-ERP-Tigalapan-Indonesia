import { redirect } from "next/navigation";

export default function PaymentMaklonRedirectPage() {
  redirect("/finance/payment?tab=maklon");
}
