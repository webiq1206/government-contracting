export type BillableProvider = {
  provider: string;
  key: string;
  validator: string;
  extraFields?: { key: string; label: string }[];
};
export const BILLABLE_PROVIDERS: BillableProvider[] = [
  { provider: "Anthropic", key: "ANTHROPIC_API_KEY", validator: "claude" },
  {
    provider: "Google Maps",
    key: "GOOGLE_MAPS_API_KEY",
    validator: "googleMaps",
  },
  { provider: "Hunter", key: "HUNTER_API_KEY", validator: "hunter" },
  {
    provider: "Twilio",
    key: "TWILIO_AUTH_TOKEN",
    validator: "twilio",
    extraFields: [
      { key: "TWILIO_ACCOUNT_SID", label: "Account SID" },
      { key: "TWILIO_FROM_NUMBER", label: "Sending phone number" },
    ],
  },
];
