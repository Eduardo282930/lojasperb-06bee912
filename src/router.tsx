import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routerWithQueryClient } from "@tanstack/react-router-with-query";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  const queryClient = new QueryClient();

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  // Entrega ao aparelho os mesmos dados que o servidor usou para montar a
  // página: o app NÃO busca o catálogo de novo ao abrir, então a vitrine
  // não troca de ordem nem pisca depois do primeiro desenho.
  return routerWithQueryClient(router, queryClient);
};
