// Fill these in after creating your Supabase project.
// Settings -> API in the Supabase dashboard.
//
// The anon key is safe to expose — it can only INSERT into the trials table
// (per the RLS policies in schema.sql). Reading requires a logged-in user.

window.APP_CONFIG = {
  SUPABASE_URL: "https://jjyxpbflqvtyqemgbsor.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_Tb9V4azEo7XmRx_w5OUqqA_v5w-hD-9",

  // Crop -> $/bu, used to calculate $/A Increase (matches your vlookup sheet).
  CROP_PRICE: {
    Corn: 4,
    SB: 10,
    Wheat: 5,
    Other: 0,
  },
};
