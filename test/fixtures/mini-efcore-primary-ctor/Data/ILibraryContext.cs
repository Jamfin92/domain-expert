using Microsoft.EntityFrameworkCore;
using Mini.Library.Models;

namespace Mini.Library.Data;

/// <summary>
/// Exists so the context can list an interface AFTER its base argument list.
/// </summary>
public interface ILibraryContext
{
    DbSet<Book> Books { get; }
}
