using Routes.Api.Models;

namespace Routes.Api.Repositories;

public interface IGadgetRepository
{
    Gadget Load(int id);
    void Remove(int id);
}
