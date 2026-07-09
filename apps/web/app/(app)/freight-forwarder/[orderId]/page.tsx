// Freight-forwarder order detail mirrors the customer drayage order detail
// (the mobile app re-exports the same screen). Reuse the Supabase-direct page.
export { default } from "../../customer/drayage/[orderId]/page";
