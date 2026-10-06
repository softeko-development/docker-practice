export type User = {
  id: number;
  name: string;
  email: string;
  bio: string | null;
  createdAt: string;
};

export type Pagination = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
};

export type UsersResponse = {
  data: User[];
  meta: Pagination;
};

export type CreateUserInput = {
  name: string;
  email: string;
  bio?: string;
};

export type ApiError = {
  message?: string;
  errors?: Record<string, string[]>;
};
