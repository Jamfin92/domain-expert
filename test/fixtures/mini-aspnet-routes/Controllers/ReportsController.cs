using Microsoft.AspNetCore.Mvc;

namespace Routes.Api.Controllers;

[Route("v1/[controller]/[action]")]
public class ReportsController : Controller
{
    [HttpGet]
    public IActionResult Summary() => Ok();

    [HttpGet("{year}")]
    public IActionResult ByYear(int year) => Ok();

    [ActionName("Totals")]
    [HttpGet]
    public IActionResult Sums() => Ok();
}
