import React from "react";

const MyTickets = () => {
  return (
    <div>

      <h1 className="text-3xl font-bold mb-6">
        My Tickets
      </h1>

      <div className="rounded-2xl border border-border p-5 bg-card">

        <h2 className="text-xl font-semibold">
          Login issue
        </h2>

        <p className="text-muted-foreground mt-2">
          Unable to login to ERP system.
        </p>

        <div className="flex items-center gap-4 mt-4">

          <span className="text-yellow-500">
            Pending
          </span>

          <span>
            High Priority
          </span>

        </div>

      </div>
    </div>
  );
};

export default MyTickets;