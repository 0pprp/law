using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Options;
using QalatLawyerApi;

public sealed class SupabaseRestClient
{
    private readonly HttpClient _http;
    private readonly SupabaseOptions _opts;
    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        PropertyNameCaseInsensitive = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    public SupabaseRestClient(HttpClient http, IOptions<SupabaseOptions> opts)
    {
        _http = http;
        _opts = opts.Value;
        _http.BaseAddress = new Uri(_opts.Url.TrimEnd('/') + "/");
    }

    private HttpRequestMessage Msg(HttpMethod method, string path, string? bearer = null, bool serviceRole = false)
    {
        var req = new HttpRequestMessage(method, path.TrimStart('/'));
        var key = serviceRole ? _opts.ServiceRoleKey : _opts.AnonKey;
        req.Headers.Add("apikey", key);
        req.Headers.Authorization = new AuthenticationHeaderValue(
            "Bearer",
            bearer ?? (serviceRole ? _opts.ServiceRoleKey : _opts.AnonKey));
        req.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        return req;
    }

    public async Task<T?> GetAsync<T>(string path, string? bearer = null, bool serviceRole = false, CancellationToken ct = default)
    {
        using var req = Msg(HttpMethod.Get, path, bearer, serviceRole);
        using var res = await _http.SendAsync(req, ct);
        var body = await res.Content.ReadAsStringAsync(ct);
        if (!res.IsSuccessStatusCode)
            throw new InvalidOperationException($"Supabase GET {path}: {(int)res.StatusCode} {body}");
        if (string.IsNullOrWhiteSpace(body) || body == "null") return default;
        return JsonSerializer.Deserialize<T>(body, JsonOpts);
    }

    public async Task<T?> PostAsync<T>(string path, object payload, string? bearer = null, bool serviceRole = false, CancellationToken ct = default)
    {
        using var req = Msg(HttpMethod.Post, path, bearer, serviceRole);
        req.Content = new StringContent(JsonSerializer.Serialize(payload, JsonOpts), Encoding.UTF8, "application/json");
        using var res = await _http.SendAsync(req, ct);
        var body = await res.Content.ReadAsStringAsync(ct);
        if (!res.IsSuccessStatusCode)
            throw new InvalidOperationException($"Supabase POST {path}: {(int)res.StatusCode} {body}");
        if (string.IsNullOrWhiteSpace(body) || body == "null") return default;
        return JsonSerializer.Deserialize<T>(body, JsonOpts);
    }

    public async Task PatchAsync(string path, object payload, string? bearer = null, bool serviceRole = false, string prefer = "return=representation", CancellationToken ct = default)
    {
        using var req = Msg(HttpMethod.Patch, path, bearer, serviceRole);
        req.Headers.TryAddWithoutValidation("Prefer", prefer);
        req.Content = new StringContent(JsonSerializer.Serialize(payload, JsonOpts), Encoding.UTF8, "application/json");
        using var res = await _http.SendAsync(req, ct);
        var body = await res.Content.ReadAsStringAsync(ct);
        if (!res.IsSuccessStatusCode)
            throw new InvalidOperationException($"Supabase PATCH {path}: {(int)res.StatusCode} {body}");
    }

    public async Task<AuthPasswordResponse?> SignInWithPasswordAsync(string email, string password, CancellationToken ct = default)
    {
        using var req = Msg(HttpMethod.Post, "auth/v1/token?grant_type=password", serviceRole: false);
        req.Content = JsonContent.Create(new { email, password });
        using var res = await _http.SendAsync(req, ct);
        var body = await res.Content.ReadAsStringAsync(ct);
        if (!res.IsSuccessStatusCode) return null;
        return JsonSerializer.Deserialize<AuthPasswordResponse>(body, JsonOpts);
    }

    public async Task<AuthUserResponse?> GetUserAsync(string accessToken, CancellationToken ct = default)
    {
        using var req = Msg(HttpMethod.Get, "auth/v1/user", bearer: accessToken);
        using var res = await _http.SendAsync(req, ct);
        var body = await res.Content.ReadAsStringAsync(ct);
        if (!res.IsSuccessStatusCode) return null;
        return JsonSerializer.Deserialize<AuthUserResponse>(body, JsonOpts);
    }

    public async Task<AdminUserResponse?> AdminGetUserAsync(string userId, CancellationToken ct = default)
    {
        return await GetAsync<AdminUserResponse>($"auth/v1/admin/users/{userId}", serviceRole: true, ct: ct);
    }
}

public sealed class AuthPasswordResponse
{
    [JsonPropertyName("access_token")] public string AccessToken { get; set; } = "";
    [JsonPropertyName("refresh_token")] public string RefreshToken { get; set; } = "";
    [JsonPropertyName("expires_in")] public int ExpiresIn { get; set; }
    [JsonPropertyName("expires_at")] public long? ExpiresAt { get; set; }
    [JsonPropertyName("token_type")] public string TokenType { get; set; } = "bearer";
    [JsonPropertyName("user")] public AuthUserResponse? User { get; set; }
}

public sealed class AuthUserResponse
{
    [JsonPropertyName("id")] public string Id { get; set; } = "";
    [JsonPropertyName("email")] public string? Email { get; set; }
}

public sealed class AdminUserResponse
{
    [JsonPropertyName("id")] public string Id { get; set; } = "";
    [JsonPropertyName("email")] public string? Email { get; set; }
}

public sealed class ProfileRow
{
    [JsonPropertyName("id")] public string Id { get; set; } = "";
    [JsonPropertyName("role")] public string Role { get; set; } = "";
    [JsonPropertyName("is_active")] public bool IsActive { get; set; }
    [JsonPropertyName("username")] public string? Username { get; set; }
    [JsonPropertyName("full_name")] public string? FullName { get; set; }
    [JsonPropertyName("phone")] public string? Phone { get; set; }
    [JsonPropertyName("branch_id")] public string? BranchId { get; set; }
    [JsonPropertyName("governorate")] public string? Governorate { get; set; }
}

public sealed class TaskRow
{
    [JsonPropertyName("id")] public string Id { get; set; } = "";
    [JsonPropertyName("assigned_to")] public string? AssignedTo { get; set; }
    [JsonPropertyName("task_status")] public string? TaskStatus { get; set; }
    [JsonPropertyName("debtor_id")] public string? DebtorId { get; set; }
    [JsonPropertyName("branch_id")] public string? BranchId { get; set; }
    [JsonPropertyName("case_id")] public string? CaseId { get; set; }
    [JsonPropertyName("task_type")] public string? TaskType { get; set; }
    [JsonPropertyName("task_definition_id")] public string? TaskDefinitionId { get; set; }
}
