using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using QalatLawyerApi;

namespace QalatLawyerApi.Controllers;

[ApiController]
[Route("auth")]
public sealed class AuthController : ControllerBase
{
    private readonly SupabaseRestClient _sb;
    private readonly SupabaseOptions _opts;

    public AuthController(SupabaseRestClient sb, IOptions<SupabaseOptions> opts)
    {
        _sb = sb;
        _opts = opts.Value;
    }

    public sealed class LoginRequest
    {
        [JsonPropertyName("username")] public string? Username { get; set; }
        [JsonPropertyName("password")] public string? Password { get; set; }
    }

    [HttpPost("mobile-login")]
    [AllowAnonymous]
    public async Task<IActionResult> MobileLogin([FromBody] LoginRequest body, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(body.Username) || string.IsNullOrWhiteSpace(body.Password))
            return BadRequest(new { error = "بيانات الدخول مطلوبة" });

        var trimmed = body.Username.Trim().ToLowerInvariant();
        AuthPasswordResponse? session;
        ProfileRow? profile;

        if (trimmed.Contains('@'))
        {
            session = await _sb.SignInWithPasswordAsync(trimmed, body.Password, ct);
            if (session?.User is null) return Unauthorized(new { error = "بيانات الدخول غير صحيحة" });
            var profiles = await _sb.GetAsync<List<ProfileRow>>(
                $"rest/v1/profiles?id=eq.{session.User.Id}&select=id,role,is_active,username,full_name,phone,branch_id,governorate",
                serviceRole: true, ct: ct);
            profile = profiles?.FirstOrDefault();
        }
        else
        {
            var profiles = await _sb.GetAsync<List<ProfileRow>>(
                $"rest/v1/profiles?username=eq.{Uri.EscapeDataString(trimmed)}&select=id,role,is_active,username,full_name,phone,branch_id,governorate",
                serviceRole: true, ct: ct);
            profile = profiles?.FirstOrDefault();
            if (profile is null) return Unauthorized(new { error = "اسم المستخدم غير موجود" });
            if (!profile.IsActive)
                return StatusCode(403, new { error = "الحساب غير فعال، يرجى التواصل مع الإدارة" });
            if (profile.Role != "lawyer")
                return StatusCode(403, new { error = "تطبيق المحامي للمحامين فقط" });

            var internalEmail = $"{trimmed}@{_opts.InternalEmailDomain}";
            session = await _sb.SignInWithPasswordAsync(internalEmail, body.Password, ct);
            if (session is null)
            {
                var adminUser = await _sb.AdminGetUserAsync(profile.Id, ct);
                if (!string.IsNullOrEmpty(adminUser?.Email) &&
                    !string.Equals(adminUser.Email, internalEmail, StringComparison.OrdinalIgnoreCase))
                {
                    session = await _sb.SignInWithPasswordAsync(adminUser.Email, body.Password, ct);
                }
            }
            if (session?.User is null) return Unauthorized(new { error = "كلمة المرور غير صحيحة" });
        }

        if (profile is null || !profile.IsActive)
            return StatusCode(403, new { error = "الحساب غير فعال، يرجى التواصل مع الإدارة" });
        if (profile.Role != "lawyer")
            return StatusCode(403, new { error = "تطبيق المحامي للمحامين فقط" });

        return Ok(new
        {
            access_token = session.AccessToken,
            refresh_token = session.RefreshToken,
            expires_in = session.ExpiresIn,
            expires_at = session.ExpiresAt,
            token_type = session.TokenType,
            user = new { id = session.User!.Id, email = session.User.Email },
            profile = new
            {
                id = profile.Id,
                role = profile.Role,
                username = profile.Username,
                full_name = profile.FullName,
                phone = profile.Phone,
                branch_id = profile.BranchId,
                governorate = profile.Governorate,
            },
        });
    }
}
