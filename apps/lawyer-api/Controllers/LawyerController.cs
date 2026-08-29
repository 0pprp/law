using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using QalatLawyerApi;

namespace QalatLawyerApi.Controllers;

[ApiController]
[Authorize]
[Route("lawyer")]
public sealed class LawyerController : ControllerBase
{
    private readonly SupabaseRestClient _sb;

    public LawyerController(SupabaseRestClient sb) => _sb = sb;

    private async Task<(ProfileRow? profile, IActionResult? error)> RequireLawyerAsync(CancellationToken ct)
    {
        var userId = User.UserId();
        if (string.IsNullOrEmpty(userId)) return (null, Unauthorized(new { error = "غير مصرح" }));
        var profiles = await _sb.GetAsync<List<ProfileRow>>(
            $"rest/v1/profiles?id=eq.{userId}&select=id,role,is_active,username,full_name,phone,branch_id,governorate",
            bearer: Request.Bearer(), ct: ct);
        var p = profiles?.FirstOrDefault();
        if (p is null || p.Role != "lawyer") return (null, StatusCode(403, new { error = "للمحامين فقط" }));
        if (!p.IsActive) return (null, StatusCode(403, new { error = "الحساب غير فعال" }));
        return (p, null);
    }

    [HttpGet("me")]
    public async Task<IActionResult> Me(CancellationToken ct)
    {
        var (profile, err) = await RequireLawyerAsync(ct);
        if (err is not null) return err;
        return Ok(new { profile });
    }

    [HttpGet("wallet")]
    public async Task<IActionResult> Wallet(CancellationToken ct)
    {
        var (profile, err) = await RequireLawyerAsync(ct);
        if (err is not null) return err;
        var userId = profile!.Id;

        // Simplified wallet snapshot via service role (mirrors Next.js lawyer/wallet intent)
        var feeBal = await SumWalletAsync(userId, "fees", ct);
        var savBal = await SumWalletAsync(userId, "savings", ct);
        var stationery = await _sb.GetAsync<List<Dictionary<string, object>>>(
            $"rest/v1/lawyer_stationery_balances?lawyer_id=eq.{userId}&select=*",
            serviceRole: true, ct: ct) ?? [];

        var feeTxs = await _sb.GetAsync<List<Dictionary<string, object>>>(
            $"rest/v1/lawyer_wallet_transactions?lawyer_id=eq.{userId}&wallet_kind=eq.fees&select=*&order=created_at.desc&limit=30",
            serviceRole: true, ct: ct) ?? [];
        var savingsTxs = await _sb.GetAsync<List<Dictionary<string, object>>>(
            $"rest/v1/lawyer_wallet_transactions?lawyer_id=eq.{userId}&wallet_kind=eq.savings&select=*&order=created_at.desc&limit=30",
            serviceRole: true, ct: ct) ?? [];
        var stationeryTxs = await _sb.GetAsync<List<Dictionary<string, object>>>(
            $"rest/v1/lawyer_stationery_transactions?lawyer_id=eq.{userId}&select=*&order=created_at.desc&limit=30",
            serviceRole: true, ct: ct) ?? [];

        return Ok(new
        {
            balances = new { fees = feeBal, savings = savBal },
            feeTxs,
            savingsTxs,
            stationery = stationery.FirstOrDefault(),
            stationeryTxs,
        });
    }

    private async Task<decimal> SumWalletAsync(string lawyerId, string kind, CancellationToken ct)
    {
        // Prefer balances table if present
        var bal = await _sb.GetAsync<List<Dictionary<string, object>>>(
            $"rest/v1/lawyer_wallet_balances?lawyer_id=eq.{lawyerId}&select=*",
            serviceRole: true, ct: ct);
        if (bal is { Count: > 0 })
        {
            var row = bal[0];
            var key = kind == "savings" ? "savings_balance" : "fees_balance";
            if (row.TryGetValue(key, out var v) && decimal.TryParse(Convert.ToString(v), out var d))
                return d;
            // alternate column names
            key = kind == "savings" ? "savings" : "fees";
            if (row.TryGetValue(key, out v) && decimal.TryParse(Convert.ToString(v), out d))
                return d;
        }

        var txs = await _sb.GetAsync<List<WalletTx>>(
            $"rest/v1/lawyer_wallet_transactions?lawyer_id=eq.{lawyerId}&wallet_kind=eq.{kind}&select=amount,direction",
            serviceRole: true, ct: ct) ?? [];
        decimal sum = 0;
        foreach (var t in txs)
        {
            var amt = t.Amount;
            if (string.Equals(t.Direction, "debit", StringComparison.OrdinalIgnoreCase) ||
                string.Equals(t.Direction, "out", StringComparison.OrdinalIgnoreCase))
                sum -= amt;
            else
                sum += amt;
        }
        return sum;
    }

    private sealed class WalletTx
    {
        [JsonPropertyName("amount")] public decimal Amount { get; set; }
        [JsonPropertyName("direction")] public string? Direction { get; set; }
    }

    public sealed class AssignmentRequest
    {
        [JsonPropertyName("taskId")] public string? TaskId { get; set; }
        [JsonPropertyName("action")] public string? Action { get; set; }
        [JsonPropertyName("reason")] public string? Reason { get; set; }
    }

    [HttpPost("task-assignment")]
    public async Task<IActionResult> TaskAssignment([FromBody] AssignmentRequest body, CancellationToken ct)
    {
        var (profile, err) = await RequireLawyerAsync(ct);
        if (err is not null) return err;
        if (string.IsNullOrWhiteSpace(body.TaskId) || string.IsNullOrWhiteSpace(body.Action))
            return BadRequest(new { error = "بيانات الطلب غير مكتملة" });

        var tasks = await _sb.GetAsync<List<TaskRow>>(
            $"rest/v1/tasks?id=eq.{body.TaskId}&select=id,assigned_to,task_status,debtor_id,branch_id",
            bearer: Request.Bearer(), ct: ct);
        var task = tasks?.FirstOrDefault();
        if (task is null || task.AssignedTo != profile!.Id)
            return NotFound(new { error = "المهمة غير موجودة أو غير مكلفة لك" });
        if (task.TaskStatus != "assignment_pending_acceptance")
            return BadRequest(new { error = "لا يوجد طلب تكليف بانتظار الرد على هذه المهمة" });

        if (body.Action == "accept")
        {
            await _sb.PatchAsync(
                $"rest/v1/tasks?id=eq.{body.TaskId}&task_status=eq.assignment_pending_acceptance",
                new
                {
                    task_status = "assigned",
                    accepted_at = DateTime.UtcNow.ToString("o"),
                    acceptance_method = "manual",
                },
                bearer: Request.Bearer(),
                ct: ct);
            return Ok(new { success = true });
        }

        if (body.Action == "reject")
        {
            if (string.IsNullOrWhiteSpace(body.Reason))
                return BadRequest(new { error = "سبب الرفض مطلوب" });
            try
            {
                await _sb.PatchAsync(
                    $"rest/v1/tasks?id=eq.{body.TaskId}&task_status=eq.assignment_pending_acceptance",
                    new
                    {
                        task_status = "waiting_assignment",
                        assigned_to = (string?)null,
                        assigned_at = (string?)null,
                        assignment_expires_at = (string?)null,
                        acceptance_method = (string?)null,
                        given_up_at = DateTime.UtcNow.ToString("o"),
                        give_up_reason = body.Reason.Trim(),
                        assignment_rejected_by = profile.Id,
                    },
                    serviceRole: true,
                    ct: ct);
            }
            catch
            {
                await _sb.PatchAsync(
                    $"rest/v1/tasks?id=eq.{body.TaskId}&task_status=eq.assignment_pending_acceptance",
                    new
                    {
                        task_status = "waiting_assignment",
                        assigned_to = (string?)null,
                        assigned_at = (string?)null,
                        assignment_expires_at = (string?)null,
                        acceptance_method = (string?)null,
                        given_up_at = DateTime.UtcNow.ToString("o"),
                        give_up_reason = body.Reason.Trim(),
                    },
                    serviceRole: true,
                    ct: ct);
            }
            return Ok(new { success = true });
        }

        return BadRequest(new { error = "إجراء غير معروف" });
    }

    public sealed class PayoutRequestBody
    {
        [JsonPropertyName("title")] public string? Title { get; set; }
        [JsonPropertyName("amount")] public decimal Amount { get; set; }
        [JsonPropertyName("notes")] public string? Notes { get; set; }
        [JsonPropertyName("walletKind")] public string? WalletKind { get; set; }
    }

    [HttpPost("payout-request")]
    public async Task<IActionResult> PayoutRequest([FromBody] PayoutRequestBody body, CancellationToken ct)
    {
        var (profile, err) = await RequireLawyerAsync(ct);
        if (err is not null) return err;
        if (body.Amount <= 0) return BadRequest(new { error = "المبلغ غير صالح" });
        var kind = body.WalletKind == "savings" ? "savings" : "fees";
        var row = new Dictionary<string, object?>
        {
            ["lawyer_id"] = profile!.Id,
            ["branch_id"] = profile.BranchId,
            ["title"] = string.IsNullOrWhiteSpace(body.Title) ? "طلب سحب" : body.Title!.Trim(),
            ["amount"] = body.Amount,
            ["notes"] = body.Notes,
            ["wallet_kind"] = kind,
            ["status"] = "pending",
        };
        try
        {
            await _sb.PostAsync<object>("rest/v1/lawyer_payout_requests", row, serviceRole: true, ct: ct);
            return Ok(new { success = true });
        }
        catch (Exception ex)
        {
            return BadRequest(new { error = ex.Message });
        }
    }

    public sealed class PersistExpensesBody
    {
        [JsonPropertyName("taskId")] public string? TaskId { get; set; }
        [JsonPropertyName("debtorId")] public string? DebtorId { get; set; }
        [JsonPropertyName("caseId")] public string? CaseId { get; set; }
        [JsonPropertyName("branchId")] public string? BranchId { get; set; }
        [JsonPropertyName("caseType")] public string? CaseType { get; set; }
        [JsonPropertyName("rows")] public List<ExpenseRow>? Rows { get; set; }
    }

    public sealed class ExpenseRow
    {
        [JsonPropertyName("name")] public string? Name { get; set; }
        [JsonPropertyName("amount")] public decimal Amount { get; set; }
        [JsonPropertyName("note")] public string? Note { get; set; }
    }

    [HttpPost("persist-task-expenses")]
    public async Task<IActionResult> PersistExpenses([FromBody] PersistExpensesBody body, CancellationToken ct)
    {
        var (profile, err) = await RequireLawyerAsync(ct);
        if (err is not null) return err;
        if (string.IsNullOrWhiteSpace(body.TaskId) || string.IsNullOrWhiteSpace(body.DebtorId))
            return BadRequest(new { error = "المهمة والمدين مطلوبان" });

        var tasks = await _sb.GetAsync<List<TaskRow>>(
            $"rest/v1/tasks?id=eq.{body.TaskId}&select=id,assigned_to,task_status,debtor_id,branch_id,case_id",
            bearer: Request.Bearer(), ct: ct);
        var task = tasks?.FirstOrDefault();
        if (task is null || task.AssignedTo != profile!.Id)
            return StatusCode(403, new { error = "المهمة غير متاحة" });

        var rows = body.Rows ?? [];
        var inserted = 0;
        decimal total = 0;
        foreach (var r in rows.Where(x => x.Amount > 0 && !string.IsNullOrWhiteSpace(x.Name)))
        {
            await _sb.PostAsync<object>("rest/v1/expenses", new
            {
                task_id = body.TaskId,
                debtor_id = body.DebtorId,
                case_id = body.CaseId ?? task.CaseId,
                branch_id = body.BranchId ?? task.BranchId,
                created_by = profile.Id,
                expense_type = r.Name!.Trim(),
                amount = r.Amount,
                description = string.IsNullOrWhiteSpace(r.Note) ? null : r.Note.Trim(),
                status = "pending",
                expense_date = DateTime.UtcNow.ToString("yyyy-MM-dd"),
                case_type = body.CaseType,
            }, serviceRole: true, ct: ct);
            inserted++;
            total += r.Amount;
        }
        return Ok(new { ok = true, count = inserted, total });
    }

    public sealed class CompleteTaskBody
    {
        [JsonPropertyName("taskId")] public string? TaskId { get; set; }
        [JsonPropertyName("fieldValues")] public Dictionary<string, object?>? FieldValues { get; set; }
        [JsonPropertyName("latitude")] public double? Latitude { get; set; }
        [JsonPropertyName("longitude")] public double? Longitude { get; set; }
        [JsonPropertyName("notes")] public string? Notes { get; set; }
    }

    [HttpPost("complete-task")]
    public async Task<IActionResult> CompleteTask([FromBody] CompleteTaskBody body, CancellationToken ct)
    {
        var (profile, err) = await RequireLawyerAsync(ct);
        if (err is not null) return err;
        if (string.IsNullOrWhiteSpace(body.TaskId))
            return BadRequest(new { error = "معرّف المهمة مطلوب" });

        var tasks = await _sb.GetAsync<List<TaskRow>>(
            $"rest/v1/tasks?id=eq.{body.TaskId}&select=id,assigned_to,task_status,debtor_id",
            bearer: Request.Bearer(), ct: ct);
        var task = tasks?.FirstOrDefault();
        if (task is null || task.AssignedTo != profile!.Id)
            return StatusCode(403, new { error = "المهمة غير متاحة" });

        // Align with web TaskUpdateForm: lawyer_notes + pending_review (fallback submitted)
        var payload = new Dictionary<string, object?>
        {
            ["task_status"] = "pending_review",
            ["completed_at"] = DateTime.UtcNow.ToString("o"),
        };
        if (!string.IsNullOrWhiteSpace(body.Notes))
            payload["lawyer_notes"] = body.Notes.Trim();
        if (body.FieldValues is not null)
            payload["completion_data"] = body.FieldValues;

        try
        {
            await _sb.PatchAsync($"rest/v1/tasks?id=eq.{body.TaskId}", payload, bearer: Request.Bearer(), ct: ct);
        }
        catch
        {
            payload["task_status"] = "submitted";
            await _sb.PatchAsync($"rest/v1/tasks?id=eq.{body.TaskId}", payload, bearer: Request.Bearer(), ct: ct);
        }

        // GPS is stored on the debtor (same as web), not on tasks
        if (body.Latitude is not null && body.Longitude is not null && !string.IsNullOrWhiteSpace(task.DebtorId))
        {
            try
            {
                await _sb.PatchAsync($"rest/v1/debtors?id=eq.{task.DebtorId}", new Dictionary<string, object?>
                {
                    ["latitude"] = body.Latitude,
                    ["longitude"] = body.Longitude,
                    ["location_captured_at"] = DateTime.UtcNow.ToString("o"),
                }, bearer: Request.Bearer(), ct: ct);
            }
            catch { /* non-fatal */ }
        }

        return Ok(new { success = true });
    }
}
