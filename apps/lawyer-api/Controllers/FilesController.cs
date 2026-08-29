using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using QalatLawyerApi;

namespace QalatLawyerApi.Controllers;

[ApiController]
[Authorize]
[Route("lawyer")]
public sealed class FilesController : ControllerBase
{
    private readonly SupabaseRestClient _sb;
    private readonly SupabaseOptions _opts;
    private readonly IHttpClientFactory _httpFactory;

    public FilesController(SupabaseRestClient sb, IOptions<SupabaseOptions> opts, IHttpClientFactory httpFactory)
    {
        _sb = sb;
        _opts = opts.Value;
        _httpFactory = httpFactory;
    }

    [HttpPost("upload-task-file")]
    [RequestSizeLimit(30_000_000)]
    public async Task<IActionResult> UploadTaskFile(
        [FromForm] string taskId,
        [FromForm] IFormFile file,
        CancellationToken ct)
    {
        var userId = User.UserId();
        if (string.IsNullOrEmpty(userId)) return Unauthorized(new { error = "غير مصرح" });
        if (string.IsNullOrWhiteSpace(taskId) || file.Length == 0)
            return BadRequest(new { error = "المهمة والملف مطلوبان" });

        var tasks = await _sb.GetAsync<List<TaskRow>>(
            $"rest/v1/tasks?id=eq.{taskId}&select=id,assigned_to",
            bearer: Request.Bearer(), ct: ct);
        var task = tasks?.FirstOrDefault();
        if (task is null || task.AssignedTo != userId)
            return StatusCode(403, new { error = "المهمة غير متاحة" });

        var ext = Path.GetExtension(file.FileName);
        if (string.IsNullOrWhiteSpace(ext)) ext = ".bin";
        var objectPath = $"task-files/{taskId}/{Guid.NewGuid():N}{ext}";

        var client = _httpFactory.CreateClient();
        await using var stream = file.OpenReadStream();
        using var content = new StreamContent(stream);
        content.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue(
            string.IsNullOrWhiteSpace(file.ContentType) ? "application/octet-stream" : file.ContentType);

        using var req = new HttpRequestMessage(
            HttpMethod.Post,
            $"{_opts.Url.TrimEnd('/')}/storage/v1/object/task-attachments/{objectPath}")
        {
            Content = content,
        };
        req.Headers.Add("apikey", _opts.ServiceRoleKey);
        req.Headers.Authorization =
            new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", _opts.ServiceRoleKey);
        req.Headers.TryAddWithoutValidation("x-upsert", "true");

        using var res = await client.SendAsync(req, ct);
        var body = await res.Content.ReadAsStringAsync(ct);
        if (!res.IsSuccessStatusCode)
            return BadRequest(new { error = $"فشل الرفع: {body}" });

        await _sb.PostAsync<object>("rest/v1/task_attachments", new
        {
            task_id = taskId,
            file_name = file.FileName,
            storage_path = objectPath,
            uploaded_by = userId,
            content_type = file.ContentType,
            size_bytes = file.Length,
        }, serviceRole: true, ct: ct);

        return Ok(new { ok = true, path = objectPath, fileName = file.FileName });
    }
}
