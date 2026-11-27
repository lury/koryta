"""PeoplePKW's output from Postgres, for a pipeline to read instead of the file.

`koryta_pkw_postgres` loads PKW's lists and refreshes `pkw.candidacy`; this
reads it. Nothing is written to versioned/ and nothing goes to the shared
cache: Postgres is the copy. A pipeline that reads PeoplePKW today switches
by declaring this source in its place - `pkw_pipeline: PeoplePKWPostgres`.
"""

from entities.person import PKW
from scrapers.stores import Context, Pipeline
from stores.pkw_postgres import read_candidacies


class PeoplePKWPostgres(Pipeline[PKW]):
    filename = None
    # Read every time: what is current is whatever was last loaded.
    volatile = True

    @property
    def output_class(self):
        return PKW

    def process(self, ctx: Context):
        return read_candidacies()
