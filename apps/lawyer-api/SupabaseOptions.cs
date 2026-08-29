namespace QalatLawyerApi;

public sealed class SupabaseOptions
{
    public const string SectionName = "Supabase";
    public string Url { get; set; } = "";
    public string AnonKey { get; set; } = "";
    public string ServiceRoleKey { get; set; } = "";
    public string JwtSecret { get; set; } = "";
    public string InternalEmailDomain { get; set; } = "internal.qalat.local";
}
