// sessionStorage, not localStorage — isolates the token per browser tab so
// logging in as a different user in a second tab never clobbers the first
// tab's session (localStorage is shared across every tab of the same
// origin; sessionStorage is not). Each tab now needs its own login.
export const setToken = (token: string) => {
  sessionStorage.setItem("token", token);
};

export const getToken = () => {
  return sessionStorage.getItem("token");
};

export const removeToken = () => {
  sessionStorage.removeItem("token");
};
