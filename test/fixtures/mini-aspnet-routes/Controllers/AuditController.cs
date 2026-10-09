using Microsoft.AspNetCore.Mvc;

namespace Routes.Api.Controllers;

[Area("Admin")]
[Route("admin/[controller]")]
public class AuditController : Controller
{
    [HttpGet]
    public IActionResult Index() => Ok();
}
