import { randomBytes } from "node:crypto";
import cookieSession from "cookie-session";
import { Router, type RequestHandler } from "express";
import passport from "passport";
import { Strategy as GitHubStrategy } from "passport-github2";
import { authState } from "../auth-state";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface User {
      login: string;
    }
  }
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace CookieSessionInterfaces {
    interface CookieSessionObject {
      oauthState?: string;
      returnTo?: string;
      regenerate?: (callback: (err?: unknown) => void) => void;
      save?: (callback: (err?: unknown) => void) => void;
    }
  }
}

export interface AuthOptions {
  clientId: string;
  clientSecret: string;
  secret: string;
  allowedUsers: string[];
}

export interface Auth {
  // The /auth routes, and loads the signed-in user.
  router: Router;
  // Rejects requests from anyone who isn't signed in.
  requireSignIn: RequestHandler;
}

export function createAuth(options: AuthOptions): Auth {
  const allowedUsers = new Set(
    options.allowedUsers.map((user) => user.toLowerCase()),
  );
  const isAllowed = (login: string) => allowedUsers.has(login.toLowerCase());

  // Passport's types return `any` for middleware by default.
  const authenticator = new passport.Passport() as passport.Authenticator<
    RequestHandler,
    RequestHandler
  >;
  authenticator.use(
    new GitHubStrategy(
      {
        clientID: options.clientId,
        clientSecret: options.clientSecret,
        callbackURL: "/auth/github/callback",
      },
      (
        _accessToken: string,
        _refreshToken: string,
        profile: passport.Profile,
        done: (err: unknown, user?: Express.User | false) => void,
      ) => {
        const login = profile.username;
        done(null, login !== undefined && isAllowed(login) ? { login } : false);
      },
    ),
  );
  authenticator.serializeUser((user, done) => {
    done(null, user.login);
  });
  // Rechecked on every request, so removed users lose access.
  authenticator.deserializeUser((login: string, done) => {
    done(null, isAllowed(login) ? { login } : false);
  });

  const router = Router();
  router.use(
    cookieSession({
      name: "llm-garage-session",
      keys: [options.secret],
      maxAge: 30 * 24 * 60 * 60 * 1000,
      sameSite: "lax",
    }),
  );
  router.use((req, _res, next) => {
    req.sessionOptions.secure = req.secure;
    // Passport needs regenerate and save, which cookie-session lacks.
    if (req.session) {
      req.session.regenerate ??= (callback) => {
        callback();
      };
      req.session.save ??= (callback) => {
        callback();
      };
    }
    next();
  });
  router.use(authenticator.session());

  router.get("/auth/signin", (req, res, next) => {
    const state = randomBytes(16).toString("hex");
    const returnTo = req.query["callbackUrl"];
    req.session = {
      oauthState: state,
      returnTo: typeof returnTo === "string" ? localPath(returnTo) : "/",
    };
    authenticator.authenticate("github", { state })(req, res, next);
  });

  router.get(
    "/auth/github/callback",
    (req, res, next) => {
      const expected = req.session?.oauthState;
      if (!expected || req.query["state"] !== expected) {
        res.status(403).type("text").send("Invalid sign in state");
        return;
      }
      next();
    },
    authenticator.authenticate("github", { failureRedirect: "/" }),
    (req, res) => {
      const returnTo = req.session?.returnTo ?? "/";
      if (req.session) {
        delete req.session.oauthState;
        delete req.session.returnTo;
      }
      res.redirect(returnTo);
    },
  );

  router.post("/auth/signout", (req, res, next) => {
    req.logout((err) => {
      if (err) {
        next(err);
        return;
      }
      res.redirect("/");
    });
  });

  router.use((req, _res, next) => {
    authState.run({ signedIn: req.isAuthenticated() }, next);
  });

  const requireSignIn: RequestHandler = (req, res, next) => {
    if (req.isAuthenticated()) {
      next();
      return;
    }
    if (req.method === "GET" || req.method === "HEAD") {
      const callbackUrl = encodeURIComponent(req.originalUrl);
      res.redirect(`/auth/signin?callbackUrl=${callbackUrl}`);
      return;
    }
    res.status(401).type("text").send("Sign in required");
  };

  return { router, requireSignIn };
}

// Only redirect within this site. Browsers treat "/\" like "//".
export function localPath(url: string): string {
  return /^\/(?![/\\])/.test(url) ? url : "/";
}
