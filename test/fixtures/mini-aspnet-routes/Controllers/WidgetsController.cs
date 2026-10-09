using Microsoft.AspNetCore.Mvc;
using Routes.Api.Data;
using Routes.Api.Models;

namespace Routes.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public class WidgetsController : ControllerBase
{
    private readonly RoutesDbContext _db = null!;

    [HttpGet]
    public IActionResult List() => Ok(_db.Widgets);

    [HttpGet("{id:int}")]
    public IActionResult Get(int id)
    {
        Widget w = null!;
        return Ok(w);
    }

    [HttpPost]
    public IActionResult Create() => Ok(new Widget());

    [HttpPut("{id}")]
    public IActionResult Update(int id) => Ok();

    [HttpDelete("{id}")]
    public IActionResult Remove(int id) => Ok();

    [HttpPatch("{id}/rename")]
    public IActionResult Rename(int id) => Ok();

    [HttpGet("/health")]
    public IActionResult Health() => Ok();

    [HttpGet("~/api/ping")]
    public IActionResult Ping() => Ok();

    [Route("search")]
    [HttpGet]
    public IActionResult Search() => Ok();

    [HttpGet("a")]
    [HttpPost("b")]
    public IActionResult Multi() => Ok();

    [HttpGet("by-code/{code:regex(^[a-z]+$)}")]
    public IActionResult ByCode(string code) => Ok();

    [HttpGet("lit[[x]]")]
    public IActionResult Literal() => Ok();

    [Microsoft.AspNetCore.Mvc.HttpGetAttribute("q")]
    public IActionResult Qualified() => Ok();

    [HttpGet("named", Name = "GetNamed")]
    public IActionResult Named() => Ok();

    [HttpDelete(Name = "OnlyName")]
    public IActionResult OnlyName() => Ok();

    [NonAction]
    public IActionResult Helper() => Ok();

    private IActionResult Hidden() => Ok();
}
