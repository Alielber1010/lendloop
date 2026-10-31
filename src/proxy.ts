import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// Signed-out visitors only see the landing page. This is a UX guard;
// the real access control is in the Convex functions.
const isAppRoute = createRouteMatcher(["/board(.*)", "/listings(.*)", "/requests(.*)", "/incoming(.*)", "/admin(.*)"]);

export default clerkMiddleware(async (auth, req) => {
  if (isAppRoute(req)) await auth.protect();
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
