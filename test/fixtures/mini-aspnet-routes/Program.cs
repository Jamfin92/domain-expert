var builder = WebApplication.CreateBuilder(args);
var app = builder.Build();

// app.MapDelete("/old", () => "gone") was removed: a comment is not a route.
app.MapGet("/ping", () => "pong");
app.MapControllerRoute(name: "default", pattern: "{controller=Home}/{action=Index}/{id?}");
app.MapControllers();
app.Run();
