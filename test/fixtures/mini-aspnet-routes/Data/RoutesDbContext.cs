using Microsoft.EntityFrameworkCore;
using Routes.Api.Models;

namespace Routes.Api.Data;

public class RoutesDbContext : DbContext
{
    public DbSet<Widget> Widgets { get; set; } = null!;
}
